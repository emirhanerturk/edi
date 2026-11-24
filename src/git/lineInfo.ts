// Per-line information for the editor: the HEAD version to compare against, and who last changed each line.
import { runGit } from './exec.js';
import { OUTSIDE, staysInside } from './files.js';
import type { BlameCommit, BlameResult, HeadText } from './types.js';

export type { BlameCommit, BlameResult, HeadText };

/** Larger HEAD versions or blame output aren't read: the editor stops at 1 MB files anyway. */
const MAX_OUTPUT = 8 * 1_048_576;

/** The file's text at HEAD; `null` if the file isn't in HEAD or the repo has no commits. */
export async function readHeadText(repo: string, relPath: unknown): Promise<HeadText> {
  if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
  const result = await runGit(repo, ['cat-file', 'blob', `HEAD:${relPath}`], { maxOutput: MAX_OUTPUT });
  if (result.ok) return { ok: true, text: result.stdout };
  if (/does not exist|not a valid object name|invalid object name|output too large|exists on disk, but not in/i.test(result.error)) {
    return { ok: true, text: null };
  }
  return { ok: false, error: result.error };
}

const countLines = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/**
 * Who last changed each line of `text`, the editor's current text for the file (saved or not). Lines
 * that differ from the committed history are "not committed yet" (null).
 */
export async function blameText(repo: string, relPath: unknown, text: string): Promise<BlameResult> {
  if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
  const result = await runGit(repo, ['blame', '--porcelain', '--contents', '-', '--', relPath], { input: text, maxOutput: MAX_OUTPUT });
  if (!result.ok) {
    // Not in HEAD (a new file) or no commits yet: nothing is committed.
    if (/no such path|no such ref|bad revision|does not have any commits|not a valid object name/i.test(result.error)) {
      return { ok: true, lines: new Array<null>(countLines(text)).fill(null), commits: {} };
    }
    return { ok: false, error: result.error };
  }
  return { ok: true, ...parseBlame(result.stdout) };
}

const HEADER = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/;
const UNCOMMITTED = /^0{40}$/;

/** Parses `git blame --porcelain`: a commit's details come only with its first line. */
export function parseBlame(out: string): { lines: (string | null)[]; commits: Record<string, BlameCommit> } {
  const lines: (string | null)[] = [];
  const commits: Record<string, BlameCommit> = {};
  let oid: string | null = null;
  let draft: Partial<BlameCommit> = {};
  for (const line of out.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      oid = header[1]!;
      draft = {};
      continue;
    }
    if (oid === null) continue;
    if (line.startsWith('\t')) {
      const committed = !UNCOMMITTED.test(oid);
      if (committed && !commits[oid] && draft.authorName !== undefined) {
        commits[oid] = {
          authorName: draft.authorName,
          authorEmail: draft.authorEmail ?? '',
          date: draft.date ?? 0,
          summary: draft.summary ?? '',
        };
      }
      lines.push(committed ? oid : null);
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    if (key === 'author') draft.authorName = value;
    else if (key === 'author-mail') draft.authorEmail = value.replace(/^<|>$/g, '');
    else if (key === 'author-time') draft.date = Number(value) * 1000;
    else if (key === 'summary') draft.summary = value;
  }
  return { lines, commits };
}
