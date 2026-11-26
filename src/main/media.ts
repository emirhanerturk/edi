// What `edi-media://` URLs resolve to: image and video files inside a discovered repo.
// Doesn't depend on Electron; the protocol is registered in ipc.ts.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { readBlob } from '../git/blob.js';
import { locateInRepo } from '../git/files.js';
import { mediaOf } from '../shared/media.js';

const SAFE = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
const notFound = () => new Response('Not found', { status: 404, headers: SAFE });

/** `bytes=a-b`, `bytes=a-`, `bytes=-n`; null if it can't be satisfied. */
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

/** The whole file, or the byte range asked for (a video seeks with these). */
function respond(mime: string, size: number, body: (start: number, end: number) => BodyInit | null, range: string | null): Response {
  const headers: Record<string, string> = { ...SAFE, 'Content-Type': mime, 'Accept-Ranges': 'bytes' };
  if (range === null) return new Response(size === 0 ? null : body(0, size - 1), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  const part = parseRange(range, size);
  if (!part) return new Response(null, { status: 416, headers: { ...SAFE, 'Content-Range': `bytes */${size}` } });
  return new Response(body(part.start, part.end), {
    status: 206,
    headers: { ...headers, 'Content-Length': String(part.end - part.start + 1), 'Content-Range': `bytes ${part.start}-${part.end}/${size}` },
  });
}

/**
 * Serves the request. The repo path must be in the discovered list (`repoOf`), and the file inside the repo (with links resolved)
 * and with an image/video extension; otherwise 404. With `rev` (a commit id, `id^` or `id^N`), the file as it was in that commit.
 * If a byte range is requested (video), 206.
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
  const rev = url.searchParams.get('rev');
  if (rev !== null) {
    const data = await readBlob(repo, rev, path);
    return data === null ? notFound() : respond(type.mime, data.length, (start, end) => new Uint8Array(data.subarray(start, end + 1)), range);
  }
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
  return respond(type.mime, size, (start, end) => Readable.toWeb(createReadStream(located.target, { start, end })) as ReadableStream<Uint8Array>, range);
}
