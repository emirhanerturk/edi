// `edi-media://` adresinin karşılığı: keşfedilmiş bir reponun içindeki görsel ve video dosyaları.
// Electron'a bağlı değildir; protokol kaydı ipc.ts'tedir.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { locateInRepo } from '../git/files.js';
import { mediaOf } from '../shared/media.js';

const SAFE = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
const notFound = () => new Response('Not found', { status: 404, headers: SAFE });

/** `bytes=a-b`, `bytes=a-`, `bytes=-n`; karşılanamazsa null. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start < size && start <= end ? { start, end } : null;
}

/**
 * İsteği karşılar. Repo yolu keşfedilmiş listede (`repoOf`), dosya repo içinde (bağlar çözülerek)
 * ve görsel/video uzantılı olmalıdır; değilse 404. Byte aralığı istenirse (video) 206.
 */
export async function serveMedia(repoOf: (repoPath: string) => string | null, requestUrl: string, range: string | null): Promise<Response> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return notFound();
  }
  const repo = repoOf(url.searchParams.get('repo') ?? '');
  const path = url.searchParams.get('path') ?? '';
  const type = mediaOf(path);
  if (!repo || !type) return notFound();
  const located = await locateInRepo(repo, path);
  if (!located.ok) return notFound();
  let size: number;
  try {
    const info = await stat(located.target);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }
  const headers: Record<string, string> = { ...SAFE, 'Content-Type': type.mime, 'Accept-Ranges': 'bytes' };
  const body = (start: number, end: number) =>
    size === 0 ? null : (Readable.toWeb(createReadStream(located.target, { start, end })) as ReadableStream<Uint8Array>);
  if (range === null) {
    return new Response(body(0, size - 1), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  }
  const part = parseRange(range, size);
  if (!part) return new Response(null, { status: 416, headers: { ...SAFE, 'Content-Range': `bytes */${size}` } });
  return new Response(body(part.start, part.end), {
    status: 206,
    headers: { ...headers, 'Content-Length': String(part.end - part.start + 1), 'Content-Range': `bytes ${part.start}-${part.end}/${size}` },
  });
}
