// Discarding changes in the work tree: a tracked file goes back to its staged (or committed) text, a new
// file goes to the Trash. The index is never touched, so whatever is staged stays.
import { isAbsolute, relative, resolve } from 'node:path';
import { type ActionResult, CONFLICT_ERROR, LOCAL_WRITE_TIMEOUT_MS } from './actions.js';
import { runGit } from './exec.js';
import { getStatus, hasUnstaged } from './status.js';
import type { FileChange } from './types.js';

/** Moves a file to the Trash (Electron's `shell.trashItem` in the app). */
export type Trash = (absolutePath: string) => Promise<void>;

const literal = (path: string) => `:(literal)${path}`;

/** Whether `path` is relative and names something inside `repo` (not the repo itself). */
export function insideRepo(repo: string, path: string): boolean {
  if (isAbsolute(path)) return false;
  const rel = relative(repo, resolve(repo, path));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** The repo's entries with unstaged changes, read fresh; an error while there are conflicted files. */
async function unstagedEntries(repo: string): Promise<{ ok: true; files: FileChange[] } | { ok: false; error: string }> {
  const current = await getStatus(repo);
  if (!current.ok) return { ok: false, error: current.error };
  if (current.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  return { ok: true, files: current.status.files.filter(hasUnstaged) };
}

async function trashFile(repo: string, path: string, trash: Trash): Promise<ActionResult | null> {
  if (!insideRepo(repo, path)) return { ok: false, error: `Not inside the repository: ${path}` };
  try {
    await trash(resolve(repo, path));
    return null;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function restore(repo: string, paths: string[]): Promise<ActionResult | null> {
  if (paths.length === 0) return null;
  const result = await runGit(repo, ['restore', '--worktree', '--', ...paths.map(literal)], { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
  return result.ok ? null : { ok: false, error: result.error };
}

/** Discards one file's unstaged changes. The path is looked up in a fresh status, not taken on trust. */
export async function discardFile(repo: string, path: string, trash: Trash): Promise<ActionResult> {
  const entries = await unstagedEntries(repo);
  if (!entries.ok) return entries;
  const file = entries.files.find((f) => f.path === path);
  if (!file) return { ok: false, error: 'File is not in the list of changes' };
  const failed = file.kind === 'untracked' ? await trashFile(repo, file.path, trash) : await restore(repo, [file.path]);
  return failed ?? { ok: true, message: 'Discarded' };
}

/** Discards every unstaged change: tracked files are restored in one go, then new files go to the Trash. */
export async function discardAll(repo: string, trash: Trash): Promise<ActionResult> {
  const entries = await unstagedEntries(repo);
  if (!entries.ok) return entries;
  const restored = await restore(repo, entries.files.filter((f) => f.kind !== 'untracked').map((f) => f.path));
  if (restored) return restored;
  for (const file of entries.files.filter((f) => f.kind === 'untracked')) {
    const failed = await trashFile(repo, file.path, trash);
    if (failed) return failed;
  }
  return { ok: true, message: 'Discarded all changes' };
}
