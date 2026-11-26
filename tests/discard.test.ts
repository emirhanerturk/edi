import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CONFLICT_ERROR } from '../src/git/actions.js';
import { MOVED_ON, discardAll, discardFile, insideRepo } from '../src/git/discard.js';
import { getStatus, hasUnstaged } from '../src/git/status.js';
import type { FileChange } from '../src/git/types.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

/** A Trash that records what it was given and removes it. */
function fakeTrash() {
  const trashed: string[] = [];
  const trash = async (path: string) => {
    trashed.push(path);
    await rm(path, { recursive: true, force: true });
  };
  return { trashed, trash };
}

const read = (repo: string, name: string) => readFile(join(repo, name), 'utf8');
const exists = (path: string) => stat(path).then(() => true, () => false);
const status = async (repo: string) => git(repo, 'status', '--porcelain');

/** The CHANGES entries as the page last saw them. */
async function changes(repo: string): Promise<FileChange[]> {
  const current = await getStatus(repo);
  return current.ok ? current.status.files.filter(hasUnstaged) : [];
}
/** The page's entry for `path`; a plain modified one when it isn't listed (a stale row). */
async function entry(repo: string, path: string): Promise<FileChange> {
  return (await changes(repo)).find((f) => f.path === path) ?? { path, origPath: null, x: '.', y: 'M', kind: 'changed' };
}

async function repo() {
  return initRepo(await makeTmpDir(), 'r', { commit: true });
}

describe('discardFile', () => {
  it('a modified file goes back to its committed text', async () => {
    const r = await repo();
    const { trash, trashed } = fakeTrash();
    await writeFile(join(r, 'README.md'), 'edited\n');
    expect(await discardFile(r, await entry(r, 'README.md'), trash)).toEqual({ ok: true, message: 'Discarded' });
    expect(await read(r, 'README.md')).toBe('readme\n');
    expect(await status(r)).toBe('');
    expect(trashed).toEqual([]);
  });

  it('a deleted file comes back', async () => {
    const r = await repo();
    await rm(join(r, 'README.md'));
    expect((await discardFile(r, await entry(r, 'README.md'), fakeTrash().trash)).ok).toBe(true);
    expect(await read(r, 'README.md')).toBe('readme\n');
  });

  it('a partly staged file keeps its staged part', async () => {
    const r = await repo();
    await writeFile(join(r, 'README.md'), 'staged\n');
    await git(r, 'add', 'README.md');
    await writeFile(join(r, 'README.md'), 'unstaged on top\n');
    expect((await discardFile(r, await entry(r, 'README.md'), fakeTrash().trash)).ok).toBe(true);
    expect(await read(r, 'README.md')).toBe('staged\n');
    expect(await git(r, 'diff', '--cached', '--name-only')).toBe('README.md\n');
    expect(await git(r, 'diff', '--name-only')).toBe('');
  });

  it('a new file goes to the Trash', async () => {
    const r = await repo();
    const { trash, trashed } = fakeTrash();
    await writeFile(join(r, 'new.txt'), 'new\n');
    expect(await discardFile(r, await entry(r, 'new.txt'), trash)).toEqual({ ok: true, message: 'Discarded' });
    expect(trashed).toEqual([join(r, 'new.txt')]);
    expect(await status(r)).toBe('');
  });

  it('a stale path is refused and nothing is touched', async () => {
    const r = await repo();
    const { trash, trashed } = fakeTrash();
    expect(await discardFile(r, await entry(r, 'README.md'), trash)).toEqual({ ok: false, error: 'File is not in the list of changes' });
    await writeFile(join(r, 'README.md'), 'staged only\n');
    await git(r, 'add', 'README.md');
    expect(await discardFile(r, await entry(r, 'README.md'), trash)).toEqual({ ok: false, error: 'File is not in the list of changes' });
    expect(await read(r, 'README.md')).toBe('staged only\n');
    expect(await status(r)).toBe('M  README.md\n');
    expect(trashed).toEqual([]);
  });

  it('a trash that fails is reported', async () => {
    const r = await repo();
    await writeFile(join(r, 'new.txt'), 'new\n');
    const failing = async () => Promise.reject(new Error('Trash is full'));
    expect(await discardFile(r, await entry(r, 'new.txt'), failing)).toEqual({ ok: false, error: 'Trash is full' });
    expect(await exists(join(r, 'new.txt'))).toBe(true);
  });
});

describe('conflicts', () => {
  it('refuse both discarding a file and discarding all', async () => {
    const r = await repo();
    await git(r, 'switch', '-q', '-c', 'side');
    await writeFile(join(r, 'README.md'), 'side\n');
    await git(r, 'commit', '-q', '-am', 'side');
    await git(r, 'switch', '-q', 'main');
    await writeFile(join(r, 'README.md'), 'main\n');
    await git(r, 'commit', '-q', '-am', 'main');
    await promisify(execFile)('git', ['merge', 'side'], { cwd: r }).catch(() => undefined);
    await writeFile(join(r, 'other.txt'), 'x\n');
    const { trash, trashed } = fakeTrash();
    expect(await discardFile(r, await entry(r, 'other.txt'), trash)).toEqual({ ok: false, error: CONFLICT_ERROR });
    expect(await discardAll(r, await changes(r), trash)).toEqual({ ok: false, error: CONFLICT_ERROR });
    expect(trashed).toEqual([]);
    expect(await exists(join(r, '.git', 'MERGE_HEAD'))).toBe(true);
  });
});

describe('discardAll', () => {
  it('resets tracked changes, trashes new files, and keeps staged ones', async () => {
    const r = await repo();
    await writeFile(join(r, 'a.txt'), 'a\n');
    await writeFile(join(r, 'b.txt'), 'b\n');
    await git(r, 'add', '-A');
    await git(r, 'commit', '-q', '-m', 'more');
    await writeFile(join(r, 'a.txt'), 'a staged\n');
    await writeFile(join(r, 'README.md'), 'staged\n');
    await git(r, 'add', 'a.txt', 'README.md');
    await writeFile(join(r, 'README.md'), 'unstaged on top\n');
    await writeFile(join(r, 'b.txt'), 'b edited\n');
    await writeFile(join(r, 'n1.txt'), 'n1\n');
    await mkdir(join(r, 'dir'));
    await writeFile(join(r, 'dir', 'n2.txt'), 'n2\n');
    const { trash, trashed } = fakeTrash();
    expect(await discardAll(r, await changes(r), trash)).toEqual({ ok: true, message: 'Discarded all changes' });
    expect([...trashed].sort()).toEqual([join(r, 'dir', 'n2.txt'), join(r, 'n1.txt')]);
    expect(await read(r, 'README.md')).toBe('staged\n');
    expect(await read(r, 'a.txt')).toBe('a staged\n');
    expect(await read(r, 'b.txt')).toBe('b\n');
    expect(await status(r)).toBe('M  README.md\nM  a.txt\n');
  });

  it('with nothing to discard it does nothing', async () => {
    const r = await repo();
    const { trash, trashed } = fakeTrash();
    expect(await discardAll(r, await changes(r), trash)).toEqual({ ok: true, message: 'Discarded all changes' });
    expect(trashed).toEqual([]);
  });
});

describe('entries that need care', () => {
  it('an intent-to-add file leaves the index and goes to the Trash, its text kept there', async () => {
    const r = await repo();
    const { trash, trashed } = fakeTrash();
    await writeFile(join(r, 'ita.txt'), 'keep me\n');
    await git(r, 'add', '-N', 'ita.txt');
    const seen: string[] = [];
    const recording = async (path: string) => {
      seen.push(await readFile(path, 'utf8'));
      await trash(path);
    };
    expect(await discardFile(r, await entry(r, 'ita.txt'), recording)).toEqual({ ok: true, message: 'Discarded' });
    expect(trashed).toEqual([join(r, 'ita.txt')]);
    expect(seen).toEqual(['keep me\n']);
    expect(await status(r)).toBe('');
  });

  it('a nested repository is refused on its own and skipped by discard all', async () => {
    const r = await repo();
    await initRepo(r, 'nested', { commit: true });
    await writeFile(join(r, 'README.md'), 'edited\n');
    const { trash, trashed } = fakeTrash();
    expect(await discardFile(r, await entry(r, 'nested/'), trash)).toEqual({ ok: false, error: 'A repository inside this one is left alone' });
    expect(await discardAll(r, await changes(r), trash)).toEqual({ ok: true, message: 'Discarded all changes' });
    expect(trashed).toEqual([]);
    expect(await exists(join(r, 'nested', '.git'))).toBe(true);
    expect(await read(r, 'README.md')).toBe('readme\n');
  });

  it('a file whose kind changed since the question is refused', async () => {
    const r = await repo();
    const { trash, trashed } = fakeTrash();
    await writeFile(join(r, 'n.txt'), 'new\n');
    const asked = await entry(r, 'n.txt');
    await git(r, 'add', 'n.txt');
    await git(r, 'commit', '-q', '-m', 'n');
    await writeFile(join(r, 'n.txt'), 'edited after\n');
    expect(await discardFile(r, asked, trash)).toEqual({ ok: false, error: MOVED_ON });
    expect(await read(r, 'n.txt')).toBe('edited after\n');
    expect(trashed).toEqual([]);
  });

  it('discard all refuses when the changes are not the ones the user was asked about', async () => {
    const r = await repo();
    const { trash, trashed } = fakeTrash();
    await writeFile(join(r, 'README.md'), 'edited\n');
    const asked = await changes(r);
    await writeFile(join(r, 'late.txt'), 'appeared while asking\n');
    expect(await discardAll(r, asked, trash)).toEqual({ ok: false, error: MOVED_ON });
    expect(await read(r, 'README.md')).toBe('edited\n');
    expect(trashed).toEqual([]);
  });
});

describe('insideRepo', () => {
  it('only accepts relative paths that stay inside the repo', () => {
    expect(insideRepo('/w/r', 'dir/n.txt')).toBe(true);
    expect(insideRepo('/w/r', '../x')).toBe(false);
    expect(insideRepo('/w/r', 'a/../../x')).toBe(false);
    expect(insideRepo('/w/r', '/etc/passwd')).toBe(false);
    expect(insideRepo('/w/r', '.')).toBe(false);
    expect(insideRepo('/w/r', '..env')).toBe(true);
    expect(insideRepo('/w/r', '..')).toBe(false);
  });
});
