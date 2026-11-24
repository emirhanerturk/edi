// Reads a single commit's details, changed files and diffs. Read-only.
import { parseDiff } from './diffParse.js';
import { OUTPUT_TOO_LARGE, runGit } from './exec.js';
import { NO_LAZY_FETCH, PINNED, SUMMARY_FORMAT, parseSummary } from './log.js';
import type { CommitDetail, CommitFile, CommitResult } from './types.js';

export type { CommitDetail, CommitFile, CommitResult };

const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const UNREADABLE = 'Could not read this commit';
export const PARTIAL_CLONE = "This commit's file contents are not downloaded (partial clone)";
/** A commit patch larger than this isn't read: parsing runs in the main process and the result is copied to the page. */
export const MAX_COMMIT_PATCH = 8 * 1_048_576;

/**
 * Splits a multi-file patch into `diff --git` sections. Lines inside a hunk are counted,
 * so a line whose content starts with "diff --git" isn't mistaken for a new section.
 */
export function splitPatch(text: string): string[] {
  const chunks: string[][] = [];
  let oldLeft = 0;
  let newLeft = 0;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const current = chunks.at(-1);
    if (current && (oldLeft > 0 || newLeft > 0)) {
      current.push(line);
      const mark = line[0];
      if (mark === '+') newLeft--;
      else if (mark === '-') oldLeft--;
      else if (mark === ' ' || line === '') {
        oldLeft--;
        newLeft--;
      }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      chunks.push([line]);
      continue;
    }
    // Lines before the first section (the empty format line) are dropped.
    if (!current) continue;
    current.push(line);
    const match = HUNK.exec(line);
    if (match) {
      oldLeft = match[1] === undefined ? 1 : Number(match[1]);
      newLeft = match[2] === undefined ? 1 : Number(match[2]);
    }
  }
  return chunks.map((chunk) => `${chunk.join('\n')}\n`);
}

type NameStatus = Pick<CommitFile, 'path' | 'origPath' | 'letter'>;

/** `--name-status -z` output: "M\0path\0" or "R087\0old\0new\0". */
function parseNameStatus(out: string): NameStatus[] | null {
  const fields = out.split('\0');
  const files: NameStatus[] = [];
  let i = 0;
  while (i < fields.length) {
    const status = fields[i]?.replace(/^\n/, '') ?? '';
    if (status === '') {
      i++;
      continue;
    }
    const letter = status[0] as NameStatus['letter'];
    if (!'AMDRCT'.includes(letter)) return null;
    if (letter === 'R' || letter === 'C') {
      const origPath = fields[i + 1];
      const path = fields[i + 2];
      if (origPath === undefined || path === undefined) return null;
      files.push({ path, origPath, letter });
      i += 3;
    } else {
      const path = fields[i + 1];
      if (path === undefined) return null;
      files.push({ path, origPath: null, letter });
      i += 2;
    }
  }
  return files;
}

/** A diff independent of user config: external tools, textconv, color and submodule format are fixed. */
const DIFF = ['--root', '-M', '--diff-merges=first-parent', '--no-color', '--no-ext-diff', '--no-textconv', '--submodule=short'];

const failure = (error: string): CommitResult => ({ ok: false, error: /lazy fetch|promisor remote/i.test(error) ? PARTIAL_CLONE : error });

/**
 * Pairs name-status entries with patch sections. A file whose type changed (link ↔ file) is a single
 * `T` entry in the list but two sections in the patch, a deletion and a creation; both are read as one diff.
 */
function zipFiles(list: NameStatus[], chunks: string[]): CommitFile[] | null {
  const files: CommitFile[] = [];
  let next = 0;
  for (const file of list) {
    let text = chunks[next++];
    if (text === undefined) return null;
    const second = chunks[next];
    if (file.letter === 'T' && /^deleted file mode /m.test(text) && second !== undefined && /^new file mode /m.test(second)) {
      text += second;
      next++;
    }
    files.push({ ...file, diff: parseDiff(text) });
  }
  return next === chunks.length ? files : null;
}

/** `--numstat -z`: "added\tremoved\tpath\0", or for a rename "a\tr\t\0old\0new\0"; "-" for a binary file. */
function parseNumstat(out: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const counts = new Map<string, { added: number; removed: number; binary: boolean }>();
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const match = /^\n?(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i] ?? '');
    if (!match) continue;
    let path = match[3]!;
    if (path === '') {
      path = fields[i + 2] ?? '';
      i += 2;
    }
    const binary = match[1] === '-';
    const prev = counts.get(path) ?? { added: 0, removed: 0, binary: false };
    counts.set(path, {
      added: prev.added + (binary ? 0 : Number(match[1])),
      removed: prev.removed + (binary ? 0 : Number(match[2])),
      binary: prev.binary || binary,
    });
  }
  return counts;
}

/** `oid` must be a full, already validated commit id. A patch over `maxPatch` characters isn't read. */
export async function readCommit(repo: string, oid: string, maxPatch = MAX_COMMIT_PATCH): Promise<CommitResult> {
  const env = NO_LAZY_FETCH;
  const [meta, names, patch] = await Promise.all([
    runGit(repo, [...PINNED, 'show', '-s', '--no-color', '--decorate=short', '--abbrev=7', `--format=${SUMMARY_FORMAT}%x1f%b`, oid, '--'], { env }),
    runGit(repo, [...PINNED, 'show', '--format=', '--name-status', '-z', ...DIFF, oid, '--'], { env }),
    runGit(repo, [...PINNED, 'show', '--format=', '-p', ...DIFF, oid, '--'], { env, maxOutput: maxPatch }),
  ]);
  if (!meta.ok) return failure(meta.error);
  if (!names.ok) return failure(names.error);
  const tooLarge = !patch.ok && patch.error === OUTPUT_TOO_LARGE;
  if (!patch.ok && !tooLarge) return failure(patch.error);

  const fields = meta.stdout.split('\x1f');
  const summary = parseSummary(fields.slice(0, 8));
  if (!summary) return { ok: false, error: UNREADABLE };
  const body = fields.slice(8).join('\x1f').trimEnd();

  const list = parseNameStatus(names.stdout);
  if (!list) return { ok: false, error: UNREADABLE };

  let files: CommitFile[] | null;
  if (tooLarge) {
    // Only counts instead of lines.
    const numstat = await runGit(repo, [...PINNED, 'show', '--format=', '--numstat', '-z', ...DIFF, oid, '--'], { env });
    if (!numstat.ok) return failure(numstat.error);
    const counts = parseNumstat(numstat.stdout);
    files = list.map((file) => {
      const count = counts.get(file.path) ?? { added: 0, removed: 0, binary: false };
      return { ...file, diff: { hunks: [], added: count.added, removed: count.removed, binary: count.binary } };
    });
  } else {
    files = zipFiles(list, splitPatch(patch.stdout));
    if (!files) return { ok: false, error: UNREADABLE };
  }

  const commit: CommitDetail = {
    ...summary,
    body,
    files,
    tooLarge,
    added: files.reduce((sum, file) => sum + file.diff.added, 0),
    removed: files.reduce((sum, file) => sum + file.diff.removed, 0),
  };
  return { ok: true, commit };
}
