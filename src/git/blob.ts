// A file's bytes as they were in a commit, for the image and video previews. Paths stay inside the repo.
import { spawn } from 'node:child_process';
import { MEDIA_REV } from '../shared/media.js';
import { gitEnv, runGit } from './exec.js';
import { staysInside } from './files.js';

/** A preview isn't worth more than this; a larger file isn't read. */
export const MAX_BLOB_BYTES = 100 * 1_048_576;

const spec = (rev: unknown, path: unknown): string | null =>
  typeof rev === 'string' && MEDIA_REV.test(rev) && staysInside(path) ? `${rev}:${path}` : null;

/** The file's size in bytes at `rev`; null if it isn't there (or `rev` or `path` isn't valid). */
export async function blobSize(repo: string, rev: unknown, path: unknown): Promise<number | null> {
  const object = spec(rev, path);
  if (object === null) return null;
  const result = await runGit(repo, ['cat-file', '-s', object], { timeoutMs: 10_000 });
  const size = result.ok ? Number(result.stdout.trim()) : NaN;
  return Number.isInteger(size) && size >= 0 ? size : null;
}

/** The file's bytes at `rev`; null if it isn't there, is larger than `maxBytes`, or git fails. */
export async function readBlob(repo: string, rev: unknown, path: unknown, maxBytes = MAX_BLOB_BYTES): Promise<Buffer | null> {
  const object = spec(rev, path);
  const size = object === null ? null : await blobSize(repo, rev, path);
  if (object === null || size === null || size > maxBytes) return null;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let done = false;
    const finish = (value: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn('git', ['cat-file', 'blob', object], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'], env: gitEnv(repo) });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(null);
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxBytes) {
        child.kill('SIGTERM');
        finish(null);
      } else chunks.push(chunk);
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? Buffer.concat(chunks, length) : null));
  });
}
