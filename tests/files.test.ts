import { chmod, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_WRITE_BYTES, OUTSIDE, listDir, listFiles, readRepoFile, resolveInRepo, writeRepoFile } from '../src/git/files.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);

async function repoWithOutside() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', { commit: true });
  await writeFile(join(dir, 'outside.txt'), 'secret\n');
  await mkdir(join(dir, 'outside-dir'));
  await writeFile(join(dir, 'outside-dir', 'x.txt'), 'secret\n');
  return { dir, repo };
}

describe('listFiles', () => {
  it('lists tracked and new files but not deleted ones, with ignored files listed separately', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, '.gitignore'), 'node_modules/\n*.log\n');
    await mkdir(join(repo, 'src', 'deep'), { recursive: true });
    await mkdir(join(repo, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'x\n');
    await writeFile(join(repo, 'src', 'deep', 'b.ts'), 'x\n');
    await writeFile(join(repo, 'node_modules', 'x', 'index.js'), 'x\n');
    await writeFile(join(repo, 'debug.log'), 'x\n');
    await git(repo, 'add', 'src/a.ts');
    await writeFile(join(repo, 'to-delete.txt'), 'x\n');
    await git(repo, 'add', 'to-delete.txt');
    await git(repo, 'commit', '-q', '-m', 'feat: x');
    await rm(join(repo, 'to-delete.txt'));

    await writeFile(join(repo, 'src', 'deep', 'trace.log'), 'x\n');
    // An ignored folder is a single entry (with a trailing `/`); its contents are not listed.
    expect(await listFiles(repo)).toEqual({
      ok: true,
      files: ['.gitignore', 'README.md', 'src/a.ts', 'src/deep/b.ts'],
      ignored: ['debug.log', 'node_modules/', 'src/deep/trace.log'],
      dirs: [],
    });
  });

  it('lists empty folders, nested ones too: git leaves them out, but a new folder must show', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'empty'));
    await mkdir(join(repo, 'outer', 'inner'), { recursive: true });
    await mkdir(join(repo, 'full'));
    await writeFile(join(repo, 'full', 'x.txt'), 'x\n');
    const result = await listFiles(repo);
    expect(result.ok && result.dirs).toEqual(['empty', 'outer', 'outer/inner']);
  });

  it('returns names with spaces, Turkish letters or a leading dash as they are', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'boş dosya.txt'), 'x\n');
    await writeFile(join(repo, '-dash.txt'), 'x\n');
    await writeFile(join(repo, 'çığ.md'), 'x\n');
    const result = await listFiles(repo);
    expect(result.ok && result.files).toEqual(['-dash.txt', 'README.md', 'boş dosya.txt', 'çığ.md']);
  });

  it('works in a repo without commits', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await writeFile(join(repo, 'first.txt'), 'x\n');
    expect(await listFiles(repo)).toEqual({ ok: true, files: ['first.txt'], ignored: [], dirs: [] });
  });

  it('returns an error in a folder that is not a repo', async () => {
    expect((await listFiles(await makeTmpDir())).ok).toBe(false);
  });
});

describe('readRepoFile', () => {
  it('returns the type, size and modification time of image and video files instead of their content (no size limit)', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'assets'));
    await writeFile(join(repo, 'assets', 'logo.PNG'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    await writeFile(join(repo, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(repo, 'assets', 'intro.mp4'), Buffer.alloc(MAX_FILE_BYTES + 10));
    const png = await readRepoFile(repo, 'assets/logo.PNG');
    expect(png).toMatchObject({ ok: true, kind: 'media', media: 'image', size: 8 });
    expect(png.ok && png.kind === 'media' && png.mtime > 0).toBe(true);
    expect(await readRepoFile(repo, 'assets/icon.svg')).toMatchObject({ kind: 'media', media: 'image' });
    expect(await readRepoFile(repo, 'assets/intro.mp4')).toMatchObject({ kind: 'media', media: 'video', size: MAX_FILE_BYTES + 10 });
    await mkdir(join(repo, 'folder.png'));
    expect(await readRepoFile(repo, 'folder.png')).toEqual({ ok: false, error: 'Not a file' });
  });

  it('reads a text file', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'çığ dosya.ts'), 'const a = 1;\n');
    expect(await readRepoFile(repo, 'src/çığ dosya.ts')).toEqual({ ok: true, kind: 'text', text: 'const a = 1;\n', size: 13 });
    expect(await readRepoFile(repo, 'README.md')).toMatchObject({ kind: 'text', text: 'readme\n' });
  });

  it('reads an empty file as empty text', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'empty.txt'), '');
    expect(await readRepoFile(repo, 'empty.txt')).toEqual({ ok: true, kind: 'text', text: '', size: 0 });
  });

  it('reads up to 1 MB and does not send one byte more', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'exact.txt'), 'a'.repeat(MAX_FILE_BYTES));
    await writeFile(join(repo, 'over.txt'), 'a'.repeat(MAX_FILE_BYTES + 1));
    const exact = await readRepoFile(repo, 'exact.txt');
    expect(exact).toMatchObject({ ok: true, kind: 'text', size: MAX_FILE_BYTES });
    expect(await readRepoFile(repo, 'over.txt')).toEqual({ ok: true, kind: 'tooLarge', size: MAX_FILE_BYTES + 1 });
  });

  it('does not send the content of a binary file', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'data.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
    expect(await readRepoFile(repo, 'data.bin')).toEqual({ ok: true, kind: 'binary', size: 12 });
  });

  it('gives a clear error for a folder and a missing file', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'src'));
    expect(await readRepoFile(repo, 'src')).toEqual({ ok: false, error: 'Not a file' });
    expect(await readRepoFile(repo, 'missing.txt')).toEqual({ ok: false, error: 'File not found' });
  });

  it('rejects every path that leaves the repo without reading it', async () => {
    const { dir, repo } = await repoWithOutside();
    await symlink('../outside.txt', join(repo, 'link.txt'));
    await symlink('../outside-dir', join(repo, 'linkdir'));
    await symlink(join(dir, 'outside.txt'), join(repo, 'abslink.txt'));
    await mkdir(join(repo, 'a'));
    const outside = { ok: false, error: 'File is outside the repository' };

    for (const path of [
      '../outside.txt',
      'a/../../outside.txt',
      './../outside.txt',
      join(dir, 'outside.txt'),
      '/etc/hosts',
      'link.txt',
      'abslink.txt',
      'linkdir/x.txt',
      '.git/config',
      '.git/HEAD',
      'a/../.git/config',
      '',
      'README.md\0.txt',
      '..',
    ]) {
      expect(await readRepoFile(repo, path), JSON.stringify(path)).toEqual(outside);
      expect(await resolveInRepo(repo, path), JSON.stringify(path)).toBeNull();
    }
  });

  it('reads a symlink that points to a file inside the repo', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await symlink('README.md', join(repo, 'READ.md'));
    expect(await readRepoFile(repo, 'READ.md')).toMatchObject({ ok: true, kind: 'text', text: 'readme\n' });
  });

  it("does not read a nested repo's .git folder, directly or through a symlink", async () => {
    const { repo } = await repoWithOutside();
    const nested = await initRepo(join(repo, 'vendor'), 'tool', { commit: true });
    await symlink(join(nested, '.git'), join(repo, 'link'));
    for (const path of ['vendor/tool/.git/config', 'vendor/tool/.GIT/config', 'vendor/tool/.git', 'link/config']) {
      expect(await readRepoFile(repo, path), path).toEqual({ ok: false, error: 'File is outside the repository' });
      expect(await resolveInRepo(repo, path), path).toBeNull();
    }
  });

  it('does not treat a file whose name starts with .. as outside the repo', async () => {
    const { repo } = await repoWithOutside();
    await writeFile(join(repo, '..notes'), 'x\n');
    expect(await readRepoFile(repo, '..notes')).toMatchObject({ ok: true, kind: 'text', text: 'x\n' });
  });

  it('rejects a FIFO without opening it (so the reader does not block)', async () => {
    const { repo } = await repoWithOutside();
    await run('mkfifo', [join(repo, 'pipe')]);
    await symlink('pipe', join(repo, 'link'));
    for (const path of ['pipe', 'link']) {
      const result = await Promise.race([readRepoFile(repo, path), new Promise((done) => setTimeout(() => done('stuck'), 1000))]);
      expect(result, path).toEqual({ ok: false, error: 'Not a file' });
    }
  });

  it('allows names that start with .git but are not .git', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, '.github'));
    await writeFile(join(repo, '.github', 'ci.yml'), 'on: push\n');
    await writeFile(join(repo, '.gitignore'), 'x\n');
    expect(await readRepoFile(repo, '.github/ci.yml')).toMatchObject({ kind: 'text' });
    expect(await readRepoFile(repo, '.gitignore')).toMatchObject({ kind: 'text' });
  });
});

describe('listDir', () => {
  it('returns one level of a folder sorted by name, marking subfolders and symlinks to folders', async () => {
    const { dir, repo } = await repoWithOutside();
    await mkdir(join(repo, 'node_modules', 'react', 'lib'), { recursive: true });
    await mkdir(join(repo, 'node_modules', '.bin'));
    await writeFile(join(repo, 'node_modules', 'react', 'index.js'), 'x\n');
    await writeFile(join(repo, 'node_modules', 'b.json'), 'x\n');
    await symlink(join(repo, 'node_modules', 'react'), join(repo, 'node_modules', 'alias'));
    await symlink(join(dir, 'outside-dir'), join(repo, 'node_modules', 'out'));
    await mkdir(join(repo, 'node_modules', '.git'));
    expect(await listDir(repo, 'node_modules')).toEqual({
      ok: true,
      entries: [
        { name: '.bin', dir: true },
        { name: 'alias', dir: true },
        { name: 'b.json', dir: false },
        { name: 'out', dir: true },
        { name: 'react', dir: true },
      ],
      more: 0,
    });
    // The contents of a symlink pointing outside are not read.
    expect(await listDir(repo, 'node_modules/out')).toEqual({ ok: false, error: OUTSIDE });
    expect(await listDir(repo, 'node_modules/react')).toMatchObject({ ok: true, entries: [{ name: 'index.js', dir: false }, { name: 'lib', dir: true }] });
  });

  it('does not list paths outside the repo, .git, missing paths or files', async () => {
    const { repo } = await repoWithOutside();
    expect(await listDir(repo, '../outside-dir')).toEqual({ ok: false, error: OUTSIDE });
    expect(await listDir(repo, '.git')).toEqual({ ok: false, error: OUTSIDE });
    expect(await listDir(repo, '')).toEqual({ ok: false, error: OUTSIDE });
    expect(await listDir(repo, 'missing')).toEqual({ ok: false, error: 'Folder not found' });
    expect(await listDir(repo, 'README.md')).toEqual({ ok: false, error: 'Not a folder' });
  });

  it('returns the first entries and counts the rest when over the limit', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'dist'));
    for (const name of ['c', 'a', 'e', 'b', 'd']) await writeFile(join(repo, 'dist', name), 'x\n');
    expect(await listDir(repo, 'dist', 3)).toEqual({
      ok: true,
      entries: [
        { name: 'a', dir: false },
        { name: 'b', dir: false },
        { name: 'c', dir: false },
      ],
      more: 2,
    });
  });
});

describe('writeRepoFile', () => {
  it('writes the new text when the disk still matches the text the edit started from', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'app.ts'), 'const a = 1;\n');
    expect(await writeRepoFile(repo, 'src/app.ts', 'const a = 2;\n', 'const a = 1;\n')).toEqual({ ok: true });
    expect(await readFile(join(repo, 'src', 'app.ts'), 'utf8')).toBe('const a = 2;\n');
    // No temp file is left behind.
    expect(await readdir(join(repo, 'src'))).toEqual(['app.ts']);
  });

  it('keeps the permission bits and writes non-ASCII text as UTF-8', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const file = join(repo, 'run ü.sh');
    await writeFile(file, '#!/bin/sh\n');
    await chmod(file, 0o755);
    expect(await writeRepoFile(repo, 'run ü.sh', '#!/bin/sh\necho "çığ"\n', '#!/bin/sh\n')).toEqual({ ok: true });
    expect((await stat(file)).mode & 0o777).toBe(0o755);
    expect(await readFile(file, 'utf8')).toBe('#!/bin/sh\necho "çığ"\n');
  });

  it('writes nothing and reports a conflict when the disk changed since the edit started', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'notes.md'), 'written by an agent\n');
    expect(await writeRepoFile(repo, 'notes.md', 'mine\n', 'original\n')).toEqual({ ok: false, error: 'The file changed on disk', conflict: 'changed' });
    expect(await readFile(join(repo, 'notes.md'), 'utf8')).toBe('written by an agent\n');
    // Without an expected text ("Keep mine") it overwrites.
    expect(await writeRepoFile(repo, 'notes.md', 'mine\n', null)).toEqual({ ok: true });
    expect(await readFile(join(repo, 'notes.md'), 'utf8')).toBe('mine\n');
  });

  it('does not create a file that no longer exists', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    expect(await writeRepoFile(repo, 'gone.txt', 'x', null)).toEqual({ ok: false, error: 'The file no longer exists', conflict: 'missing' });
    expect(await writeRepoFile(repo, 'gone.txt', 'x', 'y')).toEqual({ ok: false, error: 'The file no longer exists', conflict: 'missing' });
    await expect(stat(join(repo, 'gone.txt'))).rejects.toThrow();
  });

  it('writes through a link inside the repo to its target, keeping the link', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'real.txt'), 'old\n');
    await symlink('real.txt', join(repo, 'alias.txt'));
    expect(await writeRepoFile(repo, 'alias.txt', 'new\n', 'old\n')).toEqual({ ok: true });
    expect(await readFile(join(repo, 'real.txt'), 'utf8')).toBe('new\n');
    expect(await readlink(join(repo, 'alias.txt'))).toBe('real.txt');
  });

  it('refuses paths outside the repo, inside .git, folders, oversized text and non-string input', async () => {
    const { dir, repo } = await repoWithOutside();
    await symlink(join(dir, 'outside.txt'), join(repo, 'leak.txt'));
    for (const path of ['../outside.txt', 'leak.txt', '.git/config', '/etc/hosts']) {
      expect(await writeRepoFile(repo, path, 'x', null), path).toEqual({ ok: false, error: OUTSIDE });
    }
    expect(await readFile(join(dir, 'outside.txt'), 'utf8')).toBe('secret\n');
    await mkdir(join(repo, 'folder'));
    expect(await writeRepoFile(repo, 'folder', 'x', null)).toEqual({ ok: false, error: 'Not a file' });
    expect(await writeRepoFile(repo, 'README.md', 'x'.repeat(MAX_WRITE_BYTES + 1), null)).toEqual({ ok: false, error: 'The text is too large to save' });
    expect(await writeRepoFile(repo, 'README.md', 42 as unknown as string, null)).toEqual({ ok: false, error: 'Could not save the file' });
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('readme\n');
  });
});
