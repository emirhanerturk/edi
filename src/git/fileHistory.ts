// The commits that changed one file, following it through renames, and its change in one of them. Read-only.
import { parseDiff } from './diffParse.js';
import { OUTPUT_TOO_LARGE, runGit } from './exec.js';
import { NO_LAZY_FETCH, PINNED, SUMMARY_FORMAT, parseSummary } from './log.js';
import type { FileChangeResult, FileHistoryEntry, FileHistoryResult } from './types.js';

export type { FileChangeResult, FileHistoryEntry, FileHistoryResult };

/** A file's change in a commit larger than this isn't read: the view shows a few thousand lines at most. */
export const MAX_FILE_CHANGE_BYTES = 2 * 1_048_576;
export const CHANGE_TOO_LARGE = 'This change is too large to show';

const US = '\x1f';
const HEADER = /^[0-9a-f]{40,64}\x1f/;

/**
 * Parses `git log -z --format=<SUMMARY_FORMAT> --numstat`: each commit's fields, then (after a newline)
 * "added\tremoved\tpath", or for a rename "added\tremoved\t" followed by the old and the new path; "-" for
 * a binary file.
 */
export function parseFileHistory(out: string): FileHistoryEntry[] {
  const tokens = out.split('\0');
  const entries: FileHistoryEntry[] = [];
  let current: FileHistoryEntry | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.replace(/^\n/, '');
    if (HEADER.test(token)) {
      const commit = parseSummary(token.split(US));
      current = commit ? { commit, path: '', origPath: null, added: 0, removed: 0, binary: false } : null;
      if (current) entries.push(current);
      continue;
    }
    const stat = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(token);
    if (!current || !stat || current.path !== '') continue;
    current.binary = stat[1] === '-';
    current.added = current.binary ? 0 : Number(stat[1]);
    current.removed = current.binary ? 0 : Number(stat[2]);
    if (stat[3] !== '') current.path = stat[3]!;
    else {
      // A rename: the old path and the new one follow.
      current.origPath = tokens[i + 1] ?? null;
      current.path = tokens[i + 2] ?? '';
      i += 2;
    }
  }
  return entries.filter((entry) => entry.path !== '');
}

/** The newest `count` commits that changed the file at `path` (its path now), following renames. */
export async function readFileHistory(repo: string, path: string, count: number): Promise<FileHistoryResult> {
  const head = await runGit(repo, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { okCodes: [0, 1], env: NO_LAZY_FETCH });
  if (!head.ok) return { ok: false, error: head.error };
  if (head.stdout.trim() === '') return { ok: true, entries: [], hasMore: false };
  const result = await runGit(
    repo,
    [...PINNED, 'log', '--follow', '-M', '-z', '--no-color', '--decorate=short', '--abbrev=7', `--format=${SUMMARY_FORMAT}`, '--numstat', `--max-count=${count + 1}`, 'HEAD', '--', path],
    { env: NO_LAZY_FETCH, timeoutMs: 30_000 },
  );
  if (!result.ok) return { ok: false, error: result.error };
  const entries = parseFileHistory(result.stdout);
  return { ok: true, entries: entries.slice(0, count), hasMore: entries.length > count };
}

/**
 * The file's change in commit `oid`, against its first parent; in a root commit, the file as it was added.
 * `origPath`: where it was before, when the commit renamed it.
 */
export async function readFileChange(repo: string, oid: string, path: string, origPath: string | null): Promise<FileChangeResult> {
  const paths = origPath !== null && origPath !== path ? [origPath, path] : [path];
  const parent = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${oid}^`], { okCodes: [0, 1], env: NO_LAZY_FETCH });
  if (!parent.ok) return { ok: false, error: parent.error };
  const args =
    parent.stdout.trim() === ''
      ? [...PINNED, 'show', '--format=', '--no-color', '--no-ext-diff', '-M', oid, '--', ...paths]
      : [...PINNED, 'diff', '--no-color', '--no-ext-diff', '-M', `${oid}^`, oid, '--', ...paths];
  const result = await runGit(repo, args, { env: NO_LAZY_FETCH, maxOutput: MAX_FILE_CHANGE_BYTES });
  if (!result.ok) return { ok: false, error: result.error === OUTPUT_TOO_LARGE ? CHANGE_TOO_LARGE : result.error };
  return { ok: true, diff: parseDiff(result.stdout) };
}
