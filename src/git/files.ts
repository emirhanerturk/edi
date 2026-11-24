// Çalışma ağacındaki dosyaları listeler ve okur. Yalnız okuma yapar; Electron'a bağlı değildir.
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { runGit } from './exec.js';
import type { DirList, FileContent, FileList } from './types.js';

export type { DirList, FileContent, FileList };

const split = (stdout: string) => stdout.split('\0').filter((path) => path !== '');

/**
 * İzlenen ve izlenmeyen ama yok sayılmayan dosyalar; diskte duranlar, sıralı, repoya göre
 * göreli ve `/` ayraçlı. `.gitignore`'a takılanlar ayrı gelir (`ignored`): yok sayılan bir
 * klasör tek kayıttır, sonunda `/` olur ve içi listelenmez (ör. `node_modules/`).
 */
export async function listFiles(repo: string): Promise<FileList> {
  const [present, deleted, ignored] = await Promise.all([
    runGit(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    runGit(repo, ['ls-files', '-z', '--deleted']),
    runGit(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']),
  ]);
  if (!present.ok) return { ok: false, error: present.error };
  if (!deleted.ok) return { ok: false, error: deleted.error };
  if (!ignored.ok) return { ok: false, error: ignored.error };
  const gone = new Set(split(deleted.stdout));
  const files = [...new Set(split(present.stdout))].filter((path) => !gone.has(path));
  return { ok: true, files: files.sort(), ignored: split(ignored.stdout).sort() };
}

/** Bundan büyük dosyalar gösterilmez. */
export const MAX_FILE_BYTES = 1_048_576;
/** İkili dosya denetimi için bakılan baş kısım (git'in kendi ölçüsü). */
const SNIFF_BYTES = 8000;

export const OUTSIDE = 'File is outside the repository';

const isGitDir = (segment: string | undefined) => segment?.toLowerCase() === '.git';

/** Yol biçim olarak repo içinde mi: göreli, `..` içermeyen, `.git`'e girmeyen. Diske bakmaz. */
function staysInside(relPath: unknown): relPath is string {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0') || isAbsolute(relPath)) return false;
  const segments = relPath.split('/');
  // İç içe bir reponun .git klasörü de (vendor/tool/.git/config) kapalıdır.
  return !segments.some((segment) => segment === '..' || isGitDir(segment));
}

export type Located = { ok: true; target: string } | { ok: false; reason: 'outside' | 'missing' };

/**
 * Göreli yolu reponun içindeki gerçek yola çevirir; sembolik bağları izler. Repo dışına çıkan
 * her şey `outside`: mutlak yol, `..`, `.git` klasörü, dışarıyı gösteren bağ. Dosya yoksa `missing`.
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
  // Bağlar çözüldükten sonra da repo içinde ve .git dışında olmalı.
  const inside = relative(root, target);
  const parts = inside.split(sep);
  if (inside === '' || parts[0] === '..' || isAbsolute(inside) || parts.some(isGitDir)) return { ok: false, reason: 'outside' };
  return { ok: true, target };
}

/** Reponun içindeki gerçek yol; dışarı çıkan ya da olmayan yol için `null`. */
export async function resolveInRepo(repo: string, relPath: unknown): Promise<string | null> {
  const located = await locateInRepo(repo, relPath);
  return located.ok ? located.target : null;
}

/** Bir klasörde en çok bu kadar kayıt listelenir (ör. `node_modules`'ün içi). */
export const MAX_DIR_ENTRIES = 2000;

/**
 * Repo içindeki bir klasörün tek seviyesi; `.gitignore`'a takılan klasörlerin içini göstermek
 * için. Kayıtlar ada göre sıralı, `.git` atlanır; klasöre giden bağ klasör sayılır (içi açılırken
 * yine repo içinde mi diye bakılır). Sınırı aşan kayıtlar `more` ile sayılır.
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

/** Dosyayı salt okunur açar. Büyük ve ikili dosyaların içeriği dönmez. */
export async function readRepoFile(repo: string, relPath: unknown): Promise<FileContent> {
  const located = await locateInRepo(repo, relPath);
  if (!located.ok) return { ok: false, error: located.reason === 'outside' ? OUTSIDE : 'File not found' };
  const target = located.target;
  let handle;
  try {
    // Açmadan önce bakılır: bir FIFO'yu açmak, yazan biri gelene kadar bekler.
    if (!(await stat(target)).isFile()) return { ok: false, error: 'Not a file' };
    handle = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile()) return { ok: false, error: 'Not a file' };
    if (info.size > MAX_FILE_BYTES) return { ok: true, kind: 'tooLarge', size: info.size };
    const buffer = await handle.readFile();
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
