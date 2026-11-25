import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogoCandidates, MAX_LOGO_BYTES, checkLogo, dropLogo, findLogos, logoScore, matchesType, serveLogo, storeLogo } from '../src/main/logos.js';
import { discoverRepos } from '../src/git/discover.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 1)]);
const ICO = Buffer.concat([Buffer.from('00000100', 'hex'), Buffer.alloc(32, 2)]);
const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>\n';

async function put(root: string, path: string, content: string | Buffer): Promise<string> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

describe('logoScore', () => {
  it('ranks a logo above a wordmark, an icon and a favicon, and the shallower and the SVG first', () => {
    const paths = ['favicon.ico', 'build/icon-1024.png', 'docs/design/icon/wordmark.svg', 'public/logo.png', 'logo.svg', 'assets/logo/quizei.png'];
    const ranked = [...paths].sort((a, b) => logoScore(b)! - logoScore(a)!);
    expect(ranked).toEqual(['logo.svg', 'public/logo.png', 'docs/design/icon/wordmark.svg', 'build/icon-1024.png', 'assets/logo/quizei.png', 'favicon.ico']);
  });

  it('passes over what is not a logo, the tiny favicon sizes and dependencies', () => {
    for (const path of ['README.md', 'lexicon.png', 'src/icons/arrow.svg', 'logo.icns', 'logo.pdf', 'node_modules/pkg/logo.png', 'vendor/x/icon.png']) {
      expect(logoScore(path)).toBeNull();
    }
    expect(logoScore('favicon-16x16.png')!).toBeLessThan(logoScore('favicon.png')!);
    expect(logoScore('AppIcon.png')).not.toBeNull();
    expect(logoScore('apple-touch-icon.png')).not.toBeNull();
  });
});

describe('checkLogo', () => {
  it('accepts an image whose content is its type', async () => {
    const dir = await makeTmpDir();
    expect(await checkLogo(await put(dir, 'logo.png', PNG))).toEqual({ ok: true, real: join(dir, 'logo.png'), ext: 'png' });
    expect((await checkLogo(await put(dir, 'logo.svg', SVG))).ok).toBe(true);
    expect((await checkLogo(await put(dir, 'favicon.ico', ICO))).ok).toBe(true);
  });

  it('refuses another type, a name that lies, an empty or too large file and a missing one', async () => {
    const dir = await makeTmpDir();
    expect(await checkLogo(await put(dir, 'notes.txt', 'x'))).toMatchObject({ ok: false, error: expect.stringContaining('Not an image') });
    expect(await checkLogo(await put(dir, 'fake.png', '<html></html>'))).toEqual({ ok: false, error: 'The file is not the image its name says' });
    expect(await checkLogo(await put(dir, 'page.svg', '<html><script>x</script></html>'))).toMatchObject({ ok: false });
    expect(await checkLogo(await put(dir, 'empty.png', ''))).toMatchObject({ ok: false });
    expect(await checkLogo(await put(dir, 'big.png', Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)])))).toEqual({
      ok: false,
      error: 'The image is larger than 2 MB',
    });
    expect(await checkLogo(join(dir, 'missing.png'))).toEqual({ ok: false, error: 'Image not found' });
  });

  it('with a folder given, refuses a link that leads out of it', async () => {
    const outside = await makeTmpDir();
    const dir = await makeTmpDir();
    await symlink(await put(outside, 'logo.png', PNG), join(dir, 'logo.png'));
    expect(await checkLogo(join(dir, 'logo.png'), dir)).toEqual({ ok: false, error: 'The image is outside the folder' });
    expect((await checkLogo(join(dir, 'logo.png'))).ok).toBe(true);
  });

  it('knows the first bytes of each type', () => {
    expect(matchesType('png', PNG)).toBe(true);
    expect(matchesType('jpg', Buffer.from('ffd8ffe0', 'hex'))).toBe(true);
    expect(matchesType('gif', Buffer.from('GIF89a'))).toBe(true);
    expect(matchesType('webp', Buffer.from('RIFF0000WEBPVP8 '))).toBe(true);
    expect(matchesType('avif', Buffer.from('\0\0\0\x1cftypavif'))).toBe(true);
    expect(matchesType('svg', Buffer.from(SVG))).toBe(true);
    expect(matchesType('png', Buffer.from('ffd8ffe0', 'hex'))).toBe(false);
  });
});

describe('findLogos', () => {
  it('lists the images of a repo that look like its logo, the likeliest first, without ignored files', async () => {
    const parent = await makeTmpDir();
    const repo = await initRepo(parent, 'edi');
    await put(repo, 'docs/design/icon/wordmark.svg', SVG);
    await put(repo, 'build/icon-1024.png', PNG);
    await put(repo, 'build/icon.icns', 'icns');
    await put(repo, 'src/icons/arrow.svg', SVG);
    await put(repo, 'public/fake-logo.png', 'not a png');
    await put(repo, 'dist/logo.svg', SVG);
    await put(repo, '.gitignore', 'dist/\n');
    expect(await findLogos(repo, await discoverRepos(repo))).toEqual(['docs/design/icon/wordmark.svg', 'build/icon-1024.png']);
  });

  it('in a folder of repos, gives each image relative to the folder, at most four', async () => {
    const dir = await makeTmpDir();
    const web = await initRepo(dir, 'quizei-web');
    const app = await initRepo(dir, 'quizei-app');
    await put(web, 'public/logo.svg', SVG);
    await put(web, 'public/favicon.ico', ICO);
    await put(app, 'assets/icon.png', PNG);
    await put(app, 'assets/logo-dark.png', PNG);
    await put(app, 'assets/logo-light.png', PNG);
    const found = await findLogos(dir, await discoverRepos(dir));
    expect(found).toHaveLength(4);
    expect(found[0]).toBe('quizei-web/public/logo.svg');
    expect(found).toContain('quizei-app/assets/logo-dark.png');
    expect(found).not.toContain('quizei-web/public/favicon.ico');
  });

  it('looks through a folder without repos a few levels down', async () => {
    const dir = await makeTmpDir();
    await put(dir, 'brand/mark.png', PNG);
    await put(dir, '.hidden/logo.png', PNG);
    await put(dir, 'a/b/c/d/logo.png', PNG);
    expect(await findLogos(dir, [])).toEqual(['brand/mark.png']);
  });
});

describe('the logos edi keeps', () => {
  it('copies an image under a name of its own, serves it, and deletes it', async () => {
    const source = await put(await makeTmpDir(), 'Logo.PNG', PNG);
    const folder = join(await makeTmpDir(), 'logos');
    const stored = await storeLogo(folder, 'p1-x', source);
    expect(stored).toMatchObject({ ok: true, file: expect.stringMatching(/^p1-x-[0-9a-f]{8}\.png$/) });
    const file = stored.ok ? stored.file : '';

    const response = await serveLogo(folder, new LogoCandidates(), `edi-logo://logo/${file}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);

    await dropLogo(folder, file);
    expect(await readdir(folder)).toEqual([]);
    expect((await serveLogo(folder, new LogoCandidates(), `edi-logo://logo/${file}`)).status).toBe(404);
  });

  it('refuses to copy what is not an image', async () => {
    const source = await put(await makeTmpDir(), 'logo.png', 'text');
    expect(await storeLogo(join(await makeTmpDir(), 'logos'), 'p1', source)).toEqual({ ok: false, error: 'The file is not the image its name says' });
  });

  it('serves an image offered in the sheet by its id only, and nothing outside the logo folder', async () => {
    const dir = await makeTmpDir();
    const folder = join(dir, 'logos');
    await put(dir, 'state.json', '{}');
    const candidates = new LogoCandidates();
    const offered = candidates.add(await put(dir, 'repo/logo.svg', SVG), 'repo/logo.svg');
    expect(offered).toEqual({ id: expect.stringMatching(/^[0-9a-f]{24}$/), path: 'repo/logo.svg', url: `edi-logo://found/${offered.id}` });
    expect(candidates.path(offered.id)).toBe(join(dir, 'repo/logo.svg'));

    const response = await serveLogo(folder, candidates, offered.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");

    for (const url of ['edi-logo://found/unknown', 'edi-logo://logo/..%2Fstate.json', 'edi-logo://logo/../state.json', 'edi-logo://other/x.png', 'not a url']) {
      expect((await serveLogo(folder, candidates, url)).status).toBe(404);
    }
  });
});
