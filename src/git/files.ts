// Çalışma ağacındaki dosyaları listeler ve okur. Yalnız okuma yapar; Electron'a bağlı değildir.
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { runGit } from './exec.js';

export type FileList = { ok: true; files: string[] } | { ok: false; error: string };

const split = (stdout: string) => stdout.split('\0').filter((path) => path !== '');

/**
 * İzlenen ve izlenmeyen ama yok sayılmayan dosyalar; diskte duranlar, sıralı, repoya göre
 * göreli ve `/` ayraçlı. `.gitignore`'a takılanlar (ör. `node_modules`) gelmez.
 */
export async function listFiles(repo: string): Promise<FileList> {
  const [present, deleted] = await Promise.all([
    runGit(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    runGit(repo, ['ls-files', '-z', '--deleted']),
  ]);
  if (!present.ok) return { ok: false, error: present.error };
  if (!deleted.ok) return { ok: false, error: deleted.error };
  const gone = new Set(split(deleted.stdout));
  const files = [...new Set(split(present.stdout))].filter((path) => !gone.has(path));
  return { ok: true, files: files.sort() };
}

export type FileContent =
  | { ok: true; kind: 'text'; text: string; size: number }
  | { ok: true; kind: 'binary'; size: number }
  | { ok: true; kind: 'tooLarge'; size: number }
  | { ok: false; error: string };

/** Bundan büyük dosyalar gösterilmez. */
export const MAX_FILE_BYTES = 1_048_576;
/** İkili dosya denetimi için bakılan baş kısım (git'in kendi ölçüsü). */
const SNIFF_BYTES = 8000;

const OUTSIDE = 'File is outside the repository';

const isGitDir = (segment: string | undefined) => segment?.toLowerCase() === '.git';

/**
 * Göreli yolu reponun içindeki gerçek yola çevirir. Repo dışına çıkan her şey için `null`:
 * mutlak yol, `..`, `.git` klasörü, dışarıyı gösteren sembolik bağ, olmayan dosya.
 */
export async function resolveInRepo(repo: string, relPath: string): Promise<string | null> {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0') || isAbsolute(relPath)) return null;
  const segments = relPath.split('/');
  if (segments.some((segment) => segment === '..') || isGitDir(segments.find((segment) => segment !== '.' && segment !== ''))) return null;
  try {
    const [root, target] = await Promise.all([realpath(repo), realpath(join(repo, relPath))]);
    // Sembolik bağlar çözüldükten sonra da repo içinde ve .git dışında olmalı.
    const inside = relative(root, target);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside) || isGitDir(inside.split(sep)[0])) return null;
    return target;
  } catch {
    return null;
  }
}

/** Yol biçim olarak repo içinde mi (dosya olmasa da). Olmayan dosya ile dışarı çıkan yolu ayırmak için. */
function staysInside(relPath: string): boolean {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0') || isAbsolute(relPath)) return false;
  const segments = relPath.split('/');
  return !segments.some((segment) => segment === '..') && !isGitDir(segments.find((segment) => segment !== '.' && segment !== ''));
}

/** Dosyayı salt okunur açar. Büyük ve ikili dosyaların içeriği dönmez. */
export async function readRepoFile(repo: string, relPath: string): Promise<FileContent> {
  const target = await resolveInRepo(repo, relPath);
  if (target === null) {
    if (!staysInside(relPath)) return { ok: false, error: OUTSIDE };
    // Biçim olarak içeride: ya dosya yok ya da bir bağ dışarıyı gösteriyor.
    const exists = await realpath(join(repo, relPath)).then(() => true, () => false);
    return { ok: false, error: exists ? OUTSIDE : 'File not found' };
  }
  let handle;
  try {
    handle = await open(target, 'r');
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
