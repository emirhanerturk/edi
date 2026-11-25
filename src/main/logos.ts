// Project logos: the images offered in the sheet (found in the folder, or picked with Choose…) and the
// copies edi keeps of the chosen ones. Nothing comes from the network. Doesn't depend on Electron.
import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { Repo } from '../git/discover.js';
import { runGit } from '../git/exec.js';
import type { LogoCandidate } from '../shared/api.js';
import { LOGO_SCHEME } from '../shared/projects.js';
import { LOGO_FILE } from './projects.js';

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

/** The image types a logo can be: what the page can show in an `<img>`. */
export const LOGO_EXTENSIONS = Object.keys(TYPES);
/** A logo is small: a larger image isn't offered or copied. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** How many images found in the folder the sheet offers. */
export const MAX_FOUND = 4;

const extOf = (path: string) => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/** Folders whose images belong to something else: dependencies and vendored code. */
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'pods', 'third_party', 'third-party', 'bower_components', '.yarn', '.git']);
/** A folder that holds the logo whatever the file is called. */
const LOGO_DIRS = new Set(['logo', 'logos', 'brand', 'branding']);
const TYPE_BONUS: Record<string, number> = { svg: 8, png: 6, webp: 4, avif: 3, jpg: 3, jpeg: 3, gif: 1, ico: 0 };

/**
 * How likely the file is the project's logo, from its name, its type and how deep it is in the repo
 * (`path`, `/`-separated); null if it doesn't look like a logo at all. Higher is likelier.
 */
export function logoScore(path: string): number | null {
  const ext = extOf(path);
  if (!(ext in TYPES)) return null;
  const segments = path.split('/');
  const folders = segments.slice(0, -1).map((segment) => segment.toLowerCase());
  if (folders.some((folder) => SKIP_DIRS.has(folder))) return null;
  const tokens = segments.at(-1)!.slice(0, -(ext.length + 1)).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token !== '');
  let score: number;
  if (tokens.length === 1 && tokens[0] === 'logo') score = 50;
  else if (tokens.some((token) => token.startsWith('logo'))) score = 44;
  else if (tokens.some((token) => ['wordmark', 'brand', 'brandmark'].includes(token))) score = 36;
  else if (tokens.some((token) => token === 'icon' || token === 'appicon')) score = 32;
  else if (folders.some((folder) => LOGO_DIRS.has(folder))) score = 30;
  else if (tokens.includes('favicon')) score = 22;
  else return null;
  // The tiny sizes of a favicon set look poor at the sizes edi draws.
  if (tokens.some((token) => /^(16|32|16x16|32x32)$/.test(token))) score -= 10;
  return score + (TYPE_BONUS[ext] ?? 0) - 2 * folders.length;
}

/** The files git knows about in a repo: tracked, and untracked but not ignored. Empty if git can't list them. */
async function repoFiles(repo: string): Promise<string[]> {
  const result = await runGit(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { timeoutMs: 5000, maxOutput: 16 * 1024 * 1024 });
  return result.ok ? result.stdout.split('\0').filter((path) => path !== '') : [];
}

/** A folder holding no repo: its files a few levels down, without hidden folders and dependencies. */
async function folderFiles(dir: string, depth = 3, limit = 2000): Promise<string[]> {
  const files: string[] = [];
  const walk = async (rel: string, level: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory() && level < depth && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name.toLowerCase())) {
        await walk(path, level + 1);
      }
    }
  };
  await walk('', 0);
  return files;
}

const isInside = (root: string, path: string) => path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

async function head(path: string, bytes: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/** Whether the file's first bytes are those of the type its name says. */
export function matchesType(ext: string, start: Buffer): boolean {
  const bytes = (...values: number[]) => values.every((value, index) => start[index] === value);
  const ascii = (offset: number, text: string) => start.subarray(offset, offset + text.length).toString('latin1') === text;
  switch (ext) {
    case 'png':
      return bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'jpg':
    case 'jpeg':
      return bytes(0xff, 0xd8, 0xff);
    case 'gif':
      return ascii(0, 'GIF87a') || ascii(0, 'GIF89a');
    case 'webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'avif':
      return ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'));
    case 'ico':
      return bytes(0x00, 0x00, 0x01, 0x00);
    case 'svg':
      return /<svg[\s>]/i.test(start.toString('utf8'));
    default:
      return false;
  }
}

export type CheckedLogo = { ok: true; real: string; ext: string } | { ok: false; error: string };

/**
 * Whether the file can be a logo: a file (links followed) of a known image type, not larger than 2 MB,
 * whose content is that type. With `inside`, it must not lead out of that folder.
 */
export async function checkLogo(path: string, inside?: string): Promise<CheckedLogo> {
  const ext = extOf(path);
  if (!(ext in TYPES)) return { ok: false, error: 'Not an image edi can show: PNG, JPEG, GIF, WebP, AVIF, SVG or ICO' };
  let real: string;
  try {
    real = await realpath(path);
    if (inside !== undefined && !isInside(await realpath(inside), real)) return { ok: false, error: 'The image is outside the folder' };
    const info = await stat(real);
    if (!info.isFile() || info.size === 0) return { ok: false, error: 'Not an image file' };
    if (info.size > MAX_LOGO_BYTES) return { ok: false, error: 'The image is larger than 2 MB' };
    if (!matchesType(ext, await head(real, 4096))) return { ok: false, error: 'The file is not the image its name says' };
  } catch {
    return { ok: false, error: 'Image not found' };
  }
  return { ok: true, real, ext };
}

/**
 * The images in the folder's repos (or in the folder itself, when it holds none) that look like the
 * project's logo, the likeliest first, relative to the folder. Only images inside the folder, that
 * `checkLogo` accepts.
 */
export async function findLogos(dir: string, repos: Repo[]): Promise<string[]> {
  const lists =
    repos.length > 0
      ? await Promise.all(repos.map(async (repo) => ({ base: relative(dir, repo.path).split(sep).join('/'), files: await repoFiles(repo.path) })))
      : [{ base: '', files: await folderFiles(dir) }];
  const scored = lists
    .flatMap(({ base, files }) =>
      files.flatMap((file) => {
        const score = logoScore(file);
        return score === null ? [] : [{ path: base === '' ? file : `${base}/${file}`, score }];
      }),
    )
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const found: string[] = [];
  for (const { path } of scored.slice(0, MAX_FOUND * 3)) {
    if ((await checkLogo(join(dir, path), dir)).ok) found.push(path);
    if (found.length === MAX_FOUND) break;
  }
  return found;
}

/**
 * The images offered in the sheet this session, by the id the page got for each. These, and edi's own
 * copies, are the only files the page can show as a logo or have copied.
 */
export class LogoCandidates {
  private readonly paths = new Map<string, string>();

  add(path: string, shown: string): LogoCandidate {
    const id = randomBytes(12).toString('hex');
    this.paths.set(id, path);
    // Only the latest sheets' images matter.
    while (this.paths.size > 200) this.paths.delete(this.paths.keys().next().value!);
    return { id, path: shown, url: `${LOGO_SCHEME}://found/${id}` };
  }

  path(id: string): string | null {
    return this.paths.get(id) ?? null;
  }
}

/** The address of a logo edi keeps. */
export const logoUrl = (file: string) => `${LOGO_SCHEME}://logo/${file}`;

/** Copies the image into edi's logo folder under a name of its own, which is returned. */
export async function storeLogo(folder: string, projectId: string, source: string): Promise<{ ok: true; file: string } | { ok: false; error: string }> {
  const checked = await checkLogo(source);
  if (!checked.ok) return checked;
  const file = `${projectId}-${randomBytes(4).toString('hex')}.${checked.ext === 'jpeg' ? 'jpg' : checked.ext}`;
  if (!LOGO_FILE.test(file)) return { ok: false, error: 'Invalid request' };
  try {
    const bytes = await readFile(checked.real);
    if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: 'The image is larger than 2 MB' };
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, file), bytes, { flag: 'wx' });
  } catch {
    return { ok: false, error: 'Could not copy the image' };
  }
  return { ok: true, file };
}

/** Deletes a copy edi kept (nothing but a name `storeLogo` makes); a failure is ignored. */
export async function dropLogo(folder: string, file: string): Promise<void> {
  if (!LOGO_FILE.test(file)) return;
  await rm(join(folder, file), { force: true }).catch(() => undefined);
}

// An SVG shown through `<img>` runs no script; the policy keeps it so if it is ever opened on its own.
const SAFE = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
};
const notFound = () => new Response('Not found', { status: 404, headers: SAFE });

/**
 * What `edi-logo:` addresses resolve to: `edi-logo://logo/<file>` is a copy in edi's logo folder,
 * `edi-logo://found/<id>` an image offered in the sheet. Anything else is 404.
 */
export async function serveLogo(folder: string, candidates: LogoCandidates, requestUrl: string): Promise<Response> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return notFound();
  }
  const name = url.pathname.replace(/^\//, '');
  const path = url.host === 'logo' && LOGO_FILE.test(name) ? join(folder, name) : url.host === 'found' ? candidates.path(name) : null;
  if (path === null) return notFound();
  const checked = await checkLogo(path);
  if (!checked.ok) return notFound();
  let bytes: Buffer;
  try {
    bytes = await readFile(checked.real);
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { ...SAFE, 'Content-Type': TYPES[checked.ext]!, 'Content-Length': String(bytes.length) },
  });
}
