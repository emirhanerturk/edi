// Making, renaming and finding files and folders for the Files tab. Every path stays inside the repo and out of .git.
import { lstat, mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUTSIDE, isGitDir, locateInRepo, staysInside } from './files.js';

export type EntryResult = { ok: true; path: string } | { ok: false; error: string };
export type EntryPath = { ok: true; target: string } | { ok: false; error: string };

const GONE = 'The file or folder no longer exists';
const NO_FOLDER = 'The folder no longer exists';
const INVALID_NAME = { ok: false, error: 'Invalid name' } as const;
const taken = (name: string) => ({ ok: false as const, error: `A file or folder named ${name} already exists` });

/** A single file or folder name: not empty or blank, no `/`, not `.`, `..` or `.git`. */
export function validName(name: unknown): name is string {
  return typeof name === 'string' && name.trim() !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0') && !isGitDir(name);
}

const splitPath = (relPath: string) => {
  const slash = relPath.lastIndexOf('/');
  return { parent: slash === -1 ? '' : relPath.slice(0, slash), name: relPath.slice(slash + 1) };
};

const exists = (path: string) => lstat(path).then(
  () => true,
  () => false,
);

/** The real path of a folder in the repo ('' is the repo itself); links are followed, but must stay inside. */
async function folderIn(repo: string, relDir: string, missing: string): Promise<EntryPath> {
  if (relDir === '') return { ok: true, target: await realpath(repo) };
  const located = await locateInRepo(repo, relDir);
  if (!located.ok) return { ok: false, error: located.reason === 'outside' ? OUTSIDE : missing };
  const isDir = await stat(located.target).then(
    (info) => info.isDirectory(),
    () => false,
  );
  return isDir ? located : { ok: false, error: missing };
}

/** Creates an empty file or a folder at `relPath`; never overwrites. */
export async function createEntry(repo: string, relPath: unknown, kind: 'file' | 'dir'): Promise<EntryResult> {
  if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
  const { parent, name } = splitPath(relPath);
  if (!validName(name)) return INVALID_NAME;
  const folder = await folderIn(repo, parent, NO_FOLDER);
  if (!folder.ok) return folder;
  const target = join(folder.target, name);
  try {
    if (kind === 'file') await writeFile(target, '', { flag: 'wx' });
    else await mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return taken(name);
    return { ok: false, error: kind === 'file' ? 'Could not create the file' : 'Could not create the folder' };
  }
  return { ok: true, path: relPath };
}

/**
 * The entry's own path on disk, for the Trash and Finder: the folder it is in is resolved (and must be
 * in the repo), the entry itself isn't, so a link is the link, not what it points to.
 */
export async function entryPath(repo: string, relPath: unknown): Promise<EntryPath> {
  if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
  const { parent, name } = splitPath(relPath);
  const folder = await folderIn(repo, parent, GONE);
  if (!folder.ok) return folder;
  const target = join(folder.target, name);
  return (await exists(target)) ? { ok: true, target } : { ok: false, error: GONE };
}

/** Renames a file or folder in place (same folder, new name); the new name must be free. */
export async function renameEntry(repo: string, relPath: unknown, newName: unknown): Promise<EntryResult> {
  if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
  if (!validName(newName)) return INVALID_NAME;
  const entry = await entryPath(repo, relPath);
  if (!entry.ok) return entry;
  const { parent, name } = splitPath(relPath);
  const target = join(entry.target, '..', newName);
  // On a case-insensitive disk, A.ts "exists" when renaming a.ts to A.ts.
  if (newName.toLowerCase() !== name.toLowerCase() && (await exists(target))) return taken(newName);
  try {
    await rename(entry.target, target);
  } catch {
    return { ok: false, error: 'Could not rename' };
  }
  return { ok: true, path: parent === '' ? newName : `${parent}/${newName}` };
}
