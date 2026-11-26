// Discarding changes in the work tree: a tracked file goes back to its staged (or committed) text, a new
// file goes to the Trash. Whatever is staged stays. What runs is checked against what the user was asked
// about: the page sends the entries it showed, and a fresh status must still agree with them.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { type ActionResult, CONFLICT_ERROR, LOCAL_WRITE_TIMEOUT_MS } from './actions.js';
import { type DiscardHow, discardHow } from './discardKind.js';
import { runGit } from './exec.js';
import { getStatus, hasUnstaged } from './status.js';
import type { FileChange } from './types.js';

/** Moves a file to the Trash (Electron's `shell.trashItem` in the app). */
export type Trash = (absolutePath: string) => Promise<void>;

export const MOVED_ON = 'The changes moved on since you were asked; look again';

const literal = (path: string) => `:(literal)${path}`;

/** Whether `path` is relative and names something inside `repo` (not the repo itself). */
export function insideRepo(repo: string, path: string): boolean {
  if (isAbsolute(path)) return false;
  const rel = relative(repo, resolve(repo, path));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The repo's entries with unstaged changes, read fresh; an error while there are conflicted files. */
async function unstagedEntries(repo: string): Promise<{ ok: true; files: FileChange[] } | { ok: false; error: string }> {
  const current = await getStatus(repo);
  if (!current.ok) return { ok: false, error: current.error };
  if (current.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  return { ok: true, files: current.status.files.filter(hasUnstaged) };
}

/** An entry and how it would be discarded, as one comparable string. */
const key = (f: FileChange) => `${f.path}\0${discardHow(f).how}`;

async function trashFile(repo: string, path: string, trash: Trash): Promise<ActionResult | null> {
  if (!insideRepo(repo, path)) return { ok: false, error: `Not inside the repository: ${path}` };
  try {
    await trash(resolve(repo, path));
    return null;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function git(repo: string, args: string[]): Promise<ActionResult | null> {
  const result = await runGit(repo, args, { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
  return result.ok ? null : { ok: false, error: result.error };
}

const restore = (repo: string, paths: string[]) => (paths.length === 0 ? Promise.resolve(null) : git(repo, ['restore', '--worktree', '--', ...paths.map(literal)]));

/** Throws away one new file: an intent-to-add entry leaves the index first, then the file goes to the Trash. */
async function discardNew(repo: string, f: FileChange, how: DiscardHow['how'], trash: Trash): Promise<ActionResult | null> {
  if (!insideRepo(repo, f.path)) return { ok: false, error: `Not inside the repository: ${f.path}` };
  if (how === 'untrack-and-trash') {
    const untracked = await git(repo, ['rm', '--cached', '--quiet', '--', literal(f.path)]);
    if (untracked) return untracked;
  }
  return trashFile(repo, f.path, trash);
}

/**
 * Discards one file's unstaged changes. `asked` is the entry the user was asked about: the fresh entry for
 * its path must still be discarded the same way (a new file that became tracked is not reset instead).
 */
export async function discardFile(repo: string, asked: FileChange, trash: Trash): Promise<ActionResult> {
  const entries = await unstagedEntries(repo);
  if (!entries.ok) return entries;
  const file = entries.files.find((f) => f.path === asked.path);
  if (!file) return { ok: false, error: 'File is not in the list of changes' };
  const plan = discardHow(file);
  if (plan.how === 'refuse') return { ok: false, error: plan.reason };
  if (plan.how !== discardHow(asked).how) return { ok: false, error: MOVED_ON };
  const failed = plan.how === 'restore' ? await restore(repo, [file.path]) : await discardNew(repo, file, plan.how, trash);
  return failed ?? { ok: true, message: 'Discarded' };
}

/**
 * Discards every unstaged change the user was asked about (`asked`, the CHANGES the page showed). If the
 * fresh list differs, nothing runs. Entries that are refused (a nested repository) are left alone.
 */
export async function discardAll(repo: string, asked: FileChange[], trash: Trash): Promise<ActionResult> {
  const entries = await unstagedEntries(repo);
  if (!entries.ok) return entries;
  const fresh = entries.files.map(key).sort();
  const shown = asked.map(key).sort();
  if (fresh.length !== shown.length || fresh.some((k, i) => k !== shown[i])) return { ok: false, error: MOVED_ON };

  const restored = await restore(
    repo,
    entries.files.filter((f) => discardHow(f).how === 'restore').map((f) => f.path),
  );
  if (restored) return restored;
  for (const file of entries.files) {
    const { how } = discardHow(file);
    if (how !== 'trash' && how !== 'untrack-and-trash') continue;
    const failed = await discardNew(repo, file, how, trash);
    if (failed) return failed;
  }
  return { ok: true, message: 'Discarded all changes' };
}
