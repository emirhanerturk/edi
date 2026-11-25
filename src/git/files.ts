// Lists and reads files in the working tree. Read-only; doesn't depend on Electron.
import { type Dirent, constants } from 'node:fs';
import { type FileHandle, chmod, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { mediaOf } from '../shared/media.js';
import { runGit } from './exec.js';
import type { DirList, FileContent, FileList, WriteResult } from './types.js';

export type { DirList, FileContent, FileList };

const split = (stdout: string) => stdout.split('\0').filter((path) => path !== '');

/**
 * Tracked files and untracked but not ignored ones; only those on disk, sorted, relative to the repo
 * and `/`-separated. Those caught by `.gitignore` come separately (`ignored`): an ignored
 * folder is a single entry ending in `/`, and its contents aren't listed (e.g. `node_modules/`).
 */
export async function listFiles(repo: string): Promise<FileList> {
  const [present, deleted, ignored, untrackedDirs] = await Promise.all([
    runGit(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    runGit(repo, ['ls-files', '-z', '--deleted']),
    runGit(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']),
    runGit(repo, ['ls-files', '-z', '--others', '--exclude-standard', '--directory']),
  ]);
  if (!present.ok) return { ok: false, error: present.error };
  if (!deleted.ok) return { ok: false, error: deleted.error };
  if (!ignored.ok) return { ok: false, error: ignored.error };
  const gone = new Set(split(deleted.stdout));
  const listed = [...new Set(split(present.stdout))].filter((path) => !gone.has(path));
  // A nested repo is listed as `dir/`, a submodule as a file: both are folders whose files belong to another repo.
  const submodules = await submodulePaths(repo);
  const nested = listed.filter((path) => path.endsWith('/') || submodules.has(path)).map((path) => path.replace(/\/$/, ''));
  const files = listed.filter((path) => !path.endsWith('/') && !submodules.has(path));
  const ignoredList = split(ignored.stdout).sort();
  const dirs = untrackedDirs.ok ? await emptyDirs(repo, split(untrackedDirs.stdout), [...files, ...ignoredList, ...nested], nested) : [];
  return { ok: true, files: files.sort(), ignored: ignoredList, dirs, ...(nested.length > 0 ? { nested: nested.sort() } : {}) };
}

/** The submodules' paths, from `.gitmodules`; empty without one. */
async function submodulePaths(repo: string): Promise<Set<string>> {
  const exists = await stat(join(repo, '.gitmodules')).then((info) => info.isFile(), () => false);
  if (!exists) return new Set();
  // Exits with 1 when nothing matches. Each entry is "key\nvalue".
  const result = await runGit(repo, ['config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], { okCodes: [0, 1] });
  if (!result.ok) return new Set();
  return new Set(split(result.stdout).map((entry) => entry.slice(entry.indexOf('\n') + 1)));
}

/** At most this many empty folders are looked for: they are only there to show a just-made folder. */
const MAX_EMPTY_DIRS = 200;

/**
 * Untracked folders (`dir/` from `ls-files --directory`) with no listed file inside them, and the
 * folders below them: git collapses `a/b/` into `a/`.
 */
async function emptyDirs(repo: string, untracked: string[], listed: string[], nested: string[]): Promise<string[]> {
  const result: string[] = [];
  const holdsFiles = (dir: string) => listed.some((path) => path.startsWith(`${dir}/`));
  const walk = async (dir: string): Promise<void> => {
    // A nested repo's folders are its own.
    if (result.length >= MAX_EMPTY_DIRS || nested.includes(dir)) return;
    result.push(dir);
    let entries: Dirent[];
    try {
      entries = await readdir(join(repo, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && !isGitDir(entry.name)) await walk(`${dir}/${entry.name}`);
  };
  for (const entry of untracked) {
    if (!entry.endsWith('/')) continue;
    const dir = entry.slice(0, -1);
    if (!holdsFiles(dir)) await walk(dir);
  }
  return result.sort();
}

/** Files larger than this aren't shown. */
export const MAX_FILE_BYTES = 1_048_576;
/** The leading part inspected to detect binary files (git's own measure). */
const SNIFF_BYTES = 8000;

export const OUTSIDE = 'File is outside the repository';

export const isGitDir = (segment: string | undefined) => segment?.toLowerCase() === '.git';

/** Whether the path is syntactically inside the repo: relative, no `..`, not into `.git`. Doesn't check the disk. */
export function staysInside(relPath: unknown): relPath is string {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0') || isAbsolute(relPath)) return false;
  const segments = relPath.split('/');
  // A nested repo's .git folder (vendor/tool/.git/config) is off-limits too.
  return !segments.some((segment) => segment === '..' || isGitDir(segment));
}

export type Located = { ok: true; target: string } | { ok: false; reason: 'outside' | 'missing' };

/**
 * Resolves a relative path to the real path inside the repo, following symlinks. Anything that leaves
 * the repo is `outside`: an absolute path, `..`, the `.git` folder, a link pointing outside. `missing` if the file doesn't exist.
 */
export async function locateInRepo(repo: string, relPath: unknown): Promise<Located> {
  if (!staysInside(relPath)) return { ok: false, reason: 'outside' };
  let root: string;
  let target: string;
  try {
    [root, target] = await Promise.all([realpath(repo), realpath(join(repo, relPath))]);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  // After links are resolved it must still be inside the repo and outside .git.
  const inside = relative(root, target);
  const parts = inside.split(sep);
  if (inside === '' || parts[0] === '..' || isAbsolute(inside) || parts.some(isGitDir)) return { ok: false, reason: 'outside' };
  return { ok: true, target };
}

/** At most this much text is saved from the editor. */
export const MAX_WRITE_BYTES = 5 * 1_048_576;

const MISSING: WriteResult = { ok: false, error: 'The file no longer exists', conflict: 'missing' };

/**
 * Saves editor text over an existing file in the repo. `expected` is the disk text the edit
 * started from: if the disk no longer matches it, nothing is written (an agent may have changed the
 * file). `null` overwrites regardless. The write is atomic (a temp file in the same folder, then a
 * rename) and keeps the file's permission bits; a link is followed and stays a link.
 */
export async function writeRepoFile(repo: string, relPath: unknown, text: unknown, expected: unknown): Promise<WriteResult> {
  if (typeof text !== 'string' || (expected !== null && typeof expected !== 'string')) return { ok: false, error: 'Could not save the file' };
  if (Buffer.byteLength(text) > MAX_WRITE_BYTES) return { ok: false, error: 'The text is too large to save' };
  const located = await locateInRepo(repo, relPath);
  if (!located.ok) return located.reason === 'outside' ? { ok: false, error: OUTSIDE } : MISSING;
  const target = located.target;
  const temp = join(dirname(target), `.${basename(target)}.edi-${process.pid}-${Date.now()}.tmp`);
  try {
    const info = await stat(target);
    if (!info.isFile()) return { ok: false, error: 'Not a file' };
    if (expected !== null) {
      const current = await readRepoFile(repo, relPath);
      if (!current.ok) return current.error === 'File not found' ? MISSING : { ok: false, error: current.error };
      if (current.kind !== 'text' || current.text !== expected) return { ok: false, error: 'The file changed on disk', conflict: 'changed' };
    }
    await writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
    await chmod(temp, info.mode & 0o7777);
    await rename(temp, target);
    return { ok: true };
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? MISSING : { ok: false, error: 'Could not save the file' };
  }
}

/** The real path inside the repo; `null` for a path that leaves it or doesn't exist. */
export async function resolveInRepo(repo: string, relPath: unknown): Promise<string | null> {
  const located = await locateInRepo(repo, relPath);
  return located.ok ? located.target : null;
}

/** At most this many entries are listed in a folder (e.g. inside `node_modules`). */
export const MAX_DIR_ENTRIES = 2000;

/**
 * One level of a folder inside the repo, used to show the contents of folders caught by `.gitignore`.
 * Entries are sorted by name and `.git` is skipped; a link to a folder counts as a folder (when it is
 * expanded, it is checked again that it stays inside the repo). Entries over the limit are counted in `more`.
 */
export async function listDir(repo: string, relPath: unknown, max = MAX_DIR_ENTRIES): Promise<DirList> {
  const located = await locateInRepo(repo, relPath);
  if (!located.ok) return { ok: false, error: located.reason === 'outside' ? OUTSIDE : 'Folder not found' };
  try {
    if (!(await stat(located.target)).isDirectory()) return { ok: false, error: 'Not a folder' };
    const found = (await readdir(located.target, { withFileTypes: true }))
      .filter((entry) => !isGitDir(entry.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const shown = found.slice(0, max);
    const entries = await Promise.all(
      shown.map(async (entry) => {
        let dir = entry.isDirectory();
        if (entry.isSymbolicLink()) dir = await stat(join(located.target, entry.name)).then((info) => info.isDirectory(), () => false);
        return { name: entry.name, dir };
      }),
    );
    return { ok: true, entries, more: found.length - shown.length };
  } catch (error) {
    return { ok: false, error: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Folder not found' : 'Could not read the folder' };
  }
}

/**
 * Whether the opened file (`opened`: its fstat) is the one `relPath` finds inside the repo right now. A
 * folder on the way swapped for a link between finding the file and opening it would have opened
 * something else, perhaps outside the repo.
 */
export async function sameAsInRepo(opened: { dev: number; ino: number }, repo: string, relPath: unknown): Promise<boolean> {
  const again = await locateInRepo(repo, relPath);
  if (!again.ok) return false;
  const info = await stat(again.target).catch(() => null);
  return info !== null && info.dev === opened.dev && info.ino === opened.ino;
}

/** Reads at most `limit` bytes from the start; a file that grows while being read stops there. */
export async function readAtMost(handle: FileHandle, limit: number): Promise<Buffer> {
  const buffer = Buffer.alloc(limit);
  let length = 0;
  while (length < limit) {
    const { bytesRead } = await handle.read(buffer, length, limit - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buffer.subarray(0, length);
}

/** Opens the file read-only. The contents of large and binary files aren't returned. */
export async function readRepoFile(repo: string, relPath: unknown): Promise<FileContent> {
  const located = await locateInRepo(repo, relPath);
  if (!located.ok) return { ok: false, error: located.reason === 'outside' ? OUTSIDE : 'File not found' };
  const target = located.target;
  let handle;
  try {
    // Checked before opening: opening a FIFO blocks until a writer shows up.
    const info0 = await stat(target);
    if (!info0.isFile()) return { ok: false, error: 'Not a file' };
    // Images and videos aren't read: the page loads them from their own URL (no size limit).
    const type = mediaOf(typeof relPath === 'string' ? relPath : '');
    if (type) return { ok: true, kind: 'media', media: type.media, size: info0.size, mtime: info0.mtimeMs };
    handle = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile()) return { ok: false, error: 'Not a file' };
    if (!(await sameAsInRepo(info, repo, relPath))) return { ok: false, error: OUTSIDE };
    if (info.size > MAX_FILE_BYTES) return { ok: true, kind: 'tooLarge', size: info.size };
    // One byte past the limit tells a file that grew past it since the stat.
    const buffer = await readAtMost(handle, MAX_FILE_BYTES + 1);
    if (buffer.length > MAX_FILE_BYTES) return { ok: true, kind: 'tooLarge', size: buffer.length };
    if (buffer.subarray(0, SNIFF_BYTES).includes(0)) return { ok: true, kind: 'binary', size: buffer.length };
    return { ok: true, kind: 'text', text: buffer.toString('utf8'), size: buffer.length };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EISDIR') return { ok: false, error: 'Not a file' };
    return { ok: false, error: code === 'ENOENT' ? 'File not found' : 'Could not read the file' };
  } finally {
    await handle?.close();
  }
}
