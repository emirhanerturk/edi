import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEntry, entryPath, renameEntry, validName } from '../src/git/entries.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

async function setup() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', { commit: true });
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'a.ts'), 'a\n');
  await mkdir(join(dir, 'outside'));
  await symlink(join(dir, 'outside'), join(repo, 'link-out'));
  return { dir, repo };
}

describe('validName', () => {
  it('refuses empty names, slashes, . and .., .git and names with a NUL', () => {
    for (const name of ['', ' ', 'a/b', '.', '..', '.git', '.GIT', 'a\0b']) expect(validName(name), JSON.stringify(name)).toBe(false);
    for (const name of ['a.ts', '.env', 'boş dosya.txt', '-x']) expect(validName(name), name).toBe(true);
  });
});

describe('createEntry', () => {
  it('creates an empty file or a folder inside the repo', async () => {
    const { repo } = await setup();
    expect(await createEntry(repo, 'src/new.ts', 'file')).toEqual({ ok: true, path: 'src/new.ts' });
    expect(await readFile(join(repo, 'src', 'new.ts'), 'utf8')).toBe('');
    expect(await createEntry(repo, 'docs', 'dir')).toEqual({ ok: true, path: 'docs' });
    expect((await lstat(join(repo, 'docs'))).isDirectory()).toBe(true);
  });

  it('never overwrites: an existing name is refused', async () => {
    const { repo } = await setup();
    expect(await createEntry(repo, 'src/a.ts', 'file')).toEqual({ ok: false, error: 'A file or folder named a.ts already exists' });
    expect(await readFile(join(repo, 'src', 'a.ts'), 'utf8')).toBe('a\n');
    expect(await createEntry(repo, 'src', 'dir')).toEqual({ ok: false, error: 'A file or folder named src already exists' });
  });

  it('refuses bad names, a missing folder, .git and paths that leave the repo (also through a link)', async () => {
    const { repo } = await setup();
    expect(await createEntry(repo, 'src/..', 'file')).toEqual({ ok: false, error: 'File is outside the repository' });
    expect(await createEntry(repo, 'src/ ', 'file')).toEqual({ ok: false, error: 'Invalid name' });
    expect(await createEntry(repo, 'nope/x.ts', 'file')).toEqual({ ok: false, error: 'The folder no longer exists' });
    expect(await createEntry(repo, '.git/x', 'file')).toEqual({ ok: false, error: 'File is outside the repository' });
    expect(await createEntry(repo, 'link-out/x.ts', 'file')).toEqual({ ok: false, error: 'File is outside the repository' });
    expect(await createEntry(repo, 'src/a.ts/x', 'file')).toEqual({ ok: false, error: 'The folder no longer exists' });
  });
});

describe('renameEntry', () => {
  it('renames in place; the new name must be free', async () => {
    const { repo } = await setup();
    await writeFile(join(repo, 'src', 'b.ts'), 'b\n');
    expect(await renameEntry(repo, 'src/a.ts', 'b.ts')).toEqual({ ok: false, error: 'A file or folder named b.ts already exists' });
    expect(await renameEntry(repo, 'src/a.ts', 'c.ts')).toEqual({ ok: true, path: 'src/c.ts' });
    expect(await readFile(join(repo, 'src', 'c.ts'), 'utf8')).toBe('a\n');
    expect(await renameEntry(repo, 'src', 'lib')).toEqual({ ok: true, path: 'lib' });
    expect(await readFile(join(repo, 'lib', 'c.ts'), 'utf8')).toBe('a\n');
  });

  it('a change of case only is allowed', async () => {
    const { repo } = await setup();
    expect(await renameEntry(repo, 'src/a.ts', 'A.ts')).toEqual({ ok: true, path: 'src/A.ts' });
  });

  it('refuses a missing source, bad names and the repo root', async () => {
    const { repo } = await setup();
    expect(await renameEntry(repo, 'src/gone.ts', 'x.ts')).toEqual({ ok: false, error: 'The file or folder no longer exists' });
    expect(await renameEntry(repo, 'src/a.ts', 'x/y.ts')).toEqual({ ok: false, error: 'Invalid name' });
    expect(await renameEntry(repo, 'src/a.ts', '.git')).toEqual({ ok: false, error: 'Invalid name' });
    expect(await renameEntry(repo, '', 'x')).toEqual({ ok: false, error: 'File is outside the repository' });
  });
});

describe('entryPath', () => {
  it("the entry's own path: a link is the link itself, not where it points", async () => {
    const { repo } = await setup();
    const real = await entryPath(repo, 'src/a.ts');
    expect(real.ok && real.target.endsWith('/src/a.ts')).toBe(true);
    const link = await entryPath(repo, 'link-out');
    expect(link.ok && link.target.endsWith('/link-out')).toBe(true);
    expect(await entryPath(repo, 'link-out/x')).toEqual({ ok: false, error: 'File is outside the repository' });
    expect(await entryPath(repo, 'gone')).toEqual({ ok: false, error: 'The file or folder no longer exists' });
    expect(await entryPath(repo, '.git')).toEqual({ ok: false, error: 'File is outside the repository' });
  });
});
