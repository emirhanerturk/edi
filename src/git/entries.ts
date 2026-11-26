// Making, renaming and finding files and folders for the Files tab. Every path stays inside the repo and out of .git.
import { cp, link, lstat, mkdir, realpath, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
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

/** Creates a file (empty, or with `text`) or a folder at `relPath`; never overwrites. */
export async function createEntry(repo: string, relPath: unknown, kind: 'file' | 'dir', text = ''): Promise<EntryResult> {
  if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
  const { parent, name } = splitPath(relPath);
  if (!validName(name)) return INVALID_NAME;
  const folder = await folderIn(repo, parent, NO_FOLDER);
  if (!folder.ok) return folder;
  const target = join(folder.target, name);
  try {
    if (kind === 'file') await writeFile(target, text, { flag: 'wx' });
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
/** True for the errors a link gets on a disk without hard links (exFAT, some network shares). */
const noLinks = (error: unknown) => ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EMLINK'].includes((error as NodeJS.ErrnoException).code ?? '');

/**
 * Moves `from` to `to` without replacing anything at `to`, even if something appears there after the
 * check (Node has no exclusive rename on macOS). A file is linked at the new name, which fails if the name
 * is taken, then unlinked at the old one; a folder gets an empty folder made at the new name, which also
 * fails if it is taken, and is renamed over it (a rename replaces only an empty folder). A symbolic link,
 * or a disk without hard links, falls back to a plain rename after the check.
 * `'taken'` if the name is in use.
 */
export async function renameNoReplace(from: string, to: string): Promise<'ok' | 'taken'> {
  const info = await lstat(from);
  const plain = async () => {
    if (await exists(to)) return 'taken' as const;
    await rename(from, to);
    return 'ok' as const;
  };
  if (info.isSymbolicLink()) return plain();
  const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
  if (info.isDirectory()) {
    try {
      await mkdir(to);
    } catch (error) {
      if (code(error) === 'EEXIST') return 'taken';
      throw error;
    }
    try {
      await rename(from, to);
    } catch (error) {
      await rmdir(to).catch(() => undefined);
      // Something was put in the new folder meanwhile: the name is in use.
      if (code(error) === 'ENOTEMPTY' || code(error) === 'EEXIST') return 'taken';
      throw error;
    }
    return 'ok';
  }
  try {
    await link(from, to);
  } catch (error) {
    if (code(error) === 'EEXIST') return 'taken';
    if (noLinks(error)) return plain();
    throw error;
  }
  await unlink(from);
  return 'ok';
}

export async function renameEntry(repo: string, relPath: unknown, newName: unknown): Promise<EntryResult> {
  if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
  if (!validName(newName)) return INVALID_NAME;
  const entry = await entryPath(repo, relPath);
  if (!entry.ok) return entry;
  const { parent, name } = splitPath(relPath);
  const target = join(entry.target, '..', newName);
  try {
    // On a case-insensitive disk, A.ts "exists" when renaming a.ts to A.ts: the same entry, renamed in place.
    if (newName.toLowerCase() === name.toLowerCase()) await rename(entry.target, target);
    else if ((await renameNoReplace(entry.target, target)) === 'taken') return taken(newName);
  } catch {
    return { ok: false, error: 'Could not rename' };
  }
  return { ok: true, path: parent === '' ? newName : `${parent}/${newName}` };
}

/** The name a copy takes in `folder`: its own if free, else "name copy.ext", "name copy 2.ext"… */
export async function freeCopyName(folder: string, name: string, isDir: boolean): Promise<string> {
  if (!(await exists(join(folder, name)))) return name;
  const dot = isDir ? -1 : name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const candidate = `${stem} copy${n === 1 ? '' : ` ${n}`}${extension}`;
    if (!(await exists(join(folder, candidate)))) return candidate;
  }
  throw new Error('No free name');
}

/**
 * Copies a file or folder (`from`: a path found with `entryPath`) into the repo's folder `relDir` ('' is
 * the repo itself), under its own name or, when that is taken, "name copy": nothing is ever replaced. A
 * folder isn't copied into itself. The copy's path in the repo is returned.
 */
export async function copyEntry(repo: string, from: string, relDir: unknown): Promise<EntryResult> {
  if (typeof relDir !== 'string' || (relDir !== '' && !staysInside(relDir))) return { ok: false, error: OUTSIDE };
  const folder = await folderIn(repo, relDir, NO_FOLDER);
  if (!folder.ok) return folder;
  const info = await lstat(from).catch(() => null);
  if (!info) return { ok: false, error: GONE };
  if (info.isDirectory()) {
    const inside = relative(await realpath(from), folder.target);
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) return { ok: false, error: 'A folder cannot be copied into itself' };
  }
  let target: string;
  try {
    target = join(folder.target, await freeCopyName(folder.target, basename(from), info.isDirectory()));
    // errorOnExist with force off: if the name is taken meanwhile, the copy stops instead of replacing.
    await cp(from, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  } catch {
    return { ok: false, error: 'Could not copy it' };
  }
  return { ok: true, path: relative(await realpath(repo), target).split(sep).join('/') };
}
