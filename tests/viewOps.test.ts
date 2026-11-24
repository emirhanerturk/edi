import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIFF_TOO_LARGE, MAX_DIFF_BYTES, ViewOps } from '../src/main/viewOps.js';
import { Workspace } from '../src/main/workspace.js';
import type { OpResult } from '../src/shared/api.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

async function setup(opts: { commit?: boolean } = { commit: true }) {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', opts);
  await writeFile(join(dir, 'outside.txt'), 'secret\n');
  const ws = new Workspace({ onChange: () => undefined, statusMs: 60_000 });
  open.push(ws);
  await ws.open(dir);
  const opened: string[] = [];
  const opener = async (target: string): Promise<OpResult> => {
    opened.push(target);
    return { ok: true, message: 'Opened in Zed' };
  };
  return { dir, repo, ws, ops: new ViewOps(ws, opener), opened };
}

const UNKNOWN = { ok: false, error: 'Unknown repository' };

describe('ViewOps', () => {
  it('rejects a repo path that was not discovered in all four operations', async () => {
    const { dir, repo, ops, opened } = await setup();
    for (const path of [dir, `${repo}/../a`, `${repo}/`, join(repo, '.git'), '', null, 7, undefined]) {
      expect(await ops.diff(path, 'README.md'), String(path)).toEqual(UNKNOWN);
      expect(await ops.readFile(path, 'README.md'), String(path)).toEqual(UNKNOWN);
      expect(await ops.listFiles(path), String(path)).toEqual(UNKNOWN);
      expect(await ops.openInZed(path, null), String(path)).toEqual(UNKNOWN);
    }
    expect(opened).toEqual([]);
  });

  it('returns the diff and status entry of a changed file', async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'README.md'), 'changed\n');
    const view = await ops.diff(repo, 'README.md');
    expect(view).toMatchObject({ ok: true, file: { path: 'README.md', x: '.', y: 'M' }, diff: { added: 1, removed: 1, binary: false } });
    expect(view.ok && view.diff.hunks[0]?.lines).toEqual([
      { kind: 'del', oldNo: 1, text: 'readme' },
      { kind: 'add', newNo: 1, text: 'changed' },
    ]);
  });

  it('combines staged and unstaged changes in one diff', async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'README.md'), 'readme\ntwo\n');
    await git(repo, 'add', '-A');
    await writeFile(join(repo, 'README.md'), 'readme\ntwo\nthree\n');
    expect(await ops.diff(repo, 'README.md')).toMatchObject({ ok: true, diff: { added: 2, removed: 0 } });
  });

  it('handles a new file, odd names and a deleted file', async () => {
    const { repo, ops } = await setup();
    await mkdir(join(repo, 'boş klasör'));
    await writeFile(join(repo, 'boş klasör', '-tuhaf ad ö.txt'), 'one\ntwo\n');
    await rm(join(repo, 'README.md'));

    expect(await ops.diff(repo, 'boş klasör/-tuhaf ad ö.txt')).toMatchObject({
      ok: true,
      file: { kind: 'untracked' },
      diff: { added: 2, removed: 0 },
    });
    expect(await ops.diff(repo, 'README.md')).toMatchObject({ ok: true, diff: { added: 0, removed: 1 } });
  });

  it('returns only the content change for a renamed file', async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'long.txt'), Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: long');
    await git(repo, 'mv', 'long.txt', 'new-name.txt');
    await writeFile(join(repo, 'new-name.txt'), Array.from({ length: 20 }, (_, i) => (i === 3 ? 'changed' : `line ${i}`)).join('\n') + '\n');
    await git(repo, 'add', '-A');

    expect(await ops.diff(repo, 'new-name.txt')).toMatchObject({ ok: true, file: { origPath: 'long.txt' }, diff: { added: 1, removed: 1 } });
  });

  it('works in a repo without commits', async () => {
    const { repo, ops } = await setup({ commit: false });
    await writeFile(join(repo, 'first.txt'), 'x\n');
    await git(repo, 'add', '-A');
    expect(await ops.diff(repo, 'first.txt')).toMatchObject({ ok: true, diff: { added: 1, removed: 0 } });
  });

  it('does not read or parse a huge diff and returns a clear note', async () => {
    const { repo, ops } = await setup();
    const line = `${'x'.repeat(99)}\n`;
    await writeFile(join(repo, 'data.csv'), 'a\n');
    await git(repo, 'add', 'data.csv');
    await git(repo, 'commit', '-q', '-m', 'chore: data');
    await writeFile(join(repo, 'data.csv'), line.repeat(Math.ceil(MAX_DIFF_BYTES / line.length) + 10));
    expect(await ops.diff(repo, 'data.csv')).toEqual({ ok: false, error: DIFF_TOO_LARGE });
    await writeFile(join(repo, 'new.csv'), line.repeat(Math.ceil(MAX_DIFF_BYTES / line.length) + 10));
    expect(await ops.diff(repo, 'new.csv')).toEqual({ ok: false, error: DIFF_TOO_LARGE });
    await writeFile(join(repo, 'data.csv'), line.repeat(100));
    expect(await ops.diff(repo, 'data.csv')).toMatchObject({ ok: true, diff: { added: 100, removed: 1 } });
  });

  it('does not run diff for a path that is not in the list of changes', async () => {
    const { repo, ops } = await setup();
    const refused = { ok: false, error: 'File is not in the list of changes' };
    expect(await ops.diff(repo, 'README.md')).toEqual(refused);
    expect(await ops.diff(repo, '../outside.txt')).toEqual(refused);
    expect(await ops.diff(repo, '--output=/tmp/x')).toEqual(refused);
    expect(await ops.diff(repo, 7)).toEqual({ ok: false, error: 'Invalid file path' });
  });

  it('reads and lists files', async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'new.ts'), 'const a = 1;\n');
    expect(await ops.readFile(repo, 'new.ts')).toEqual({ ok: true, kind: 'text', text: 'const a = 1;\n', size: 13 });
    expect(await ops.listFiles(repo)).toEqual({ ok: true, files: ['README.md', 'new.ts'], ignored: [] });
    await mkdir(join(repo, 'dist'));
    await writeFile(join(repo, 'dist', 'app.js'), 'x\n');
    expect(await ops.listDir(repo, 'dist')).toEqual({ ok: true, entries: [{ name: 'app.js', dir: false }], more: 0 });
    expect(await ops.listDir(repo, 7)).toEqual({ ok: false, error: 'Invalid file path' });
    expect(await ops.listDir('/missing', 'dist')).toEqual({ ok: false, error: 'Unknown repository' });
  });

  it('does not read or open a file path that leaves the repo', async () => {
    const { dir, repo, ops, opened } = await setup();
    const outside = { ok: false, error: 'File is outside the repository' };
    for (const path of ['../outside.txt', join(dir, 'outside.txt'), '.git/config', 'a/../../outside.txt']) {
      expect(await ops.readFile(repo, path), path).toEqual(outside);
      expect(await ops.openInZed(repo, path), path).toEqual(outside);
    }
    expect(await ops.readFile(repo, 7)).toEqual({ ok: false, error: 'Invalid file path' });
    expect(await ops.openInZed(repo, 7)).toEqual({ ok: false, error: 'Invalid file path' });
    expect(opened).toEqual([]);
  });

  it('opens the file in Zed, or the repo folder when no path is given', async () => {
    const { repo, ops, opened } = await setup();
    expect(await ops.openInZed(repo, 'README.md')).toEqual({ ok: true, message: 'Opened in Zed' });
    expect(await ops.openInZed(repo, null)).toEqual({ ok: true, message: 'Opened in Zed' });
    expect(opened).toEqual([join(repo, 'README.md'), repo]);
  });

  it('opens the repo folder for a deleted file', async () => {
    const { repo, ops, opened } = await setup();
    await rm(join(repo, 'README.md'));
    expect((await ops.openInZed(repo, 'README.md')).ok).toBe(true);
    expect(opened).toEqual([repo]);
  });
});
