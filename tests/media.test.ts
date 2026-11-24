import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serveMedia } from '../src/main/media.js';
import { mediaOf, mediaUrl } from '../src/shared/media.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

describe('mediaOf', () => {
  it('maps the extension to image or video and a MIME type, ignoring case', () => {
    expect(mediaOf('a/logo.PNG')).toEqual({ media: 'image', mime: 'image/png' });
    expect(mediaOf('x.jpeg')).toEqual({ media: 'image', mime: 'image/jpeg' });
    expect(mediaOf('icon.svg')).toEqual({ media: 'image', mime: 'image/svg+xml' });
    expect(mediaOf('clip.mov')).toEqual({ media: 'video', mime: 'video/quicktime' });
    expect(mediaOf('clip.webm')).toEqual({ media: 'video', mime: 'video/webm' });
    expect(mediaOf('app.ts')).toBeNull();
    expect(mediaOf('png')).toBeNull();
    expect(mediaOf('.png')).toEqual({ media: 'image', mime: 'image/png' });
  });
});

async function setup() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', { commit: true });
  await mkdir(join(repo, 'assets'));
  await writeFile(join(repo, 'assets', 'logo.png'), Buffer.from('0123456789'));
  await writeFile(join(repo, 'notes.txt'), 'not secret, but not an image either\n');
  await writeFile(join(dir, 'outside.png'), 'outside');
  await symlink(join(dir, 'outside.png'), join(repo, 'assets', 'link.png'));
  const known = (path: string) => (path === repo ? repo : null);
  const serve = (path: string, range: string | null = null, repoPath = repo) => serveMedia(known, mediaUrl(repoPath, path, 1), range);
  return { repo, serve };
}

describe('serveMedia', () => {
  it('serves an image in the repo with its type and size', async () => {
    const { serve } = await setup();
    const response = await serve('assets/logo.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('0123456789');
  });

  it('serves only the requested byte range (video seeking) and 416 for an invalid range', async () => {
    const { serve } = await setup();
    const part = await serve('assets/logo.png', 'bytes=2-5');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    const open = await serve('assets/logo.png', 'bytes=7-');
    expect([open.status, open.headers.get('content-range'), await open.text()]).toEqual([206, 'bytes 7-9/10', '789']);
    const tail = await serve('assets/logo.png', 'bytes=-3');
    expect([tail.status, await tail.text()]).toEqual([206, '789']);
    const clipped = await serve('assets/logo.png', 'bytes=8-100');
    expect([clipped.headers.get('content-range'), await clipped.text()]).toEqual(['bytes 8-9/10', '89']);
    for (const bad of ['bytes=10-', 'bytes=5-2', 'bytes=abc', 'items=0-1']) {
      const response = await serve('assets/logo.png', bad);
      expect(response.status, bad).toBe(416);
      expect(response.headers.get('content-range'), bad).toBe('bytes */10');
    }
  });

  it('refuses an unknown repo, a path outside the repo, a symlink pointing outside, a non-media file and a missing file', async () => {
    const { serve } = await setup();
    expect((await serve('assets/logo.png', null, '/other')).status).toBe(404);
    expect((await serve('../outside.png')).status).toBe(404);
    expect((await serve('assets/link.png')).status).toBe(404);
    expect((await serve('notes.txt')).status).toBe(404);
    expect((await serve('assets/missing.png')).status).toBe(404);
    expect((await serveMedia(() => null, 'edi-media://file/', null)).status).toBe(404);
  });
});
