import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileOps, menuItems } from '../src/main/fileOps.js';
import type { Question } from '../src/main/questions.js';
import { Workspace } from '../src/main/workspace.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

async function setup() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', { commit: true });
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'a.ts'), 'a\n');
  const ws = new Workspace({ onChange: () => undefined, statusMs: 60_000 });
  open.push(ws);
  await ws.open(dir);
  const asked: Question[] = [];
  const trashed: string[] = [];
  const revealed: string[] = [];
  let answer = true;
  const ops = new FileOps(ws, {
    ask: async (question) => {
      asked.push(question);
      return answer;
    },
    trash: async (target) => {
      trashed.push(target);
    },
    reveal: (target) => revealed.push(target),
    menu: async () => 'rename',
  });
  return { repo, ops, asked, trashed, revealed, answer: (yes: boolean) => (answer = yes) };
}

const exists = (path: string) => access(path).then(() => true, () => false);
const UNKNOWN = { ok: false, error: 'Unknown repository' };

describe('FileOps', () => {
  it('creates files and folders in a discovered repo only', async () => {
    const { repo, ops } = await setup();
    expect(await ops.create(repo, 'src/b.ts', 'file')).toEqual({ ok: true, path: 'src/b.ts' });
    expect(await readFile(join(repo, 'src', 'b.ts'), 'utf8')).toBe('');
    expect(await ops.create(repo, 'lib', 'dir')).toEqual({ ok: true, path: 'lib' });
    expect(await ops.create('/nope', 'x', 'file')).toEqual(UNKNOWN);
    expect(await ops.create(repo, 'x', 'socket')).toEqual({ ok: false, error: 'Invalid request' });
  });

  it('renames; with unsaved edits in open tabs it asks first, and Cancel keeps everything', async () => {
    const { repo, ops, asked, answer } = await setup();
    expect(await ops.rename(repo, 'src/a.ts', 'b.ts', 0)).toEqual({ ok: true, path: 'src/b.ts' });
    expect(asked).toEqual([]);
    answer(false);
    expect(await ops.rename(repo, 'src/b.ts', 'c.ts', 1)).toEqual({ ok: false, error: '', cancelled: true });
    expect(asked[0]!.message).toBe('Rename "b.ts"?');
    expect(await exists(join(repo, 'src', 'b.ts'))).toBe(true);
  });

  it('moves to the Trash after asking; Cancel leaves it', async () => {
    const { repo, ops, asked, trashed, answer } = await setup();
    answer(false);
    expect(await ops.trash(repo, 'src', 0)).toEqual({ ok: false, error: '', cancelled: true });
    expect(trashed).toEqual([]);
    expect(asked[0]!.message).toBe('Move "src" to the Trash?');
    expect(asked[0]!.detail).toContain('The folder and everything in it');
    answer(true);
    expect(await ops.trash(repo, 'src/a.ts', 2)).toEqual({ ok: true, path: 'src/a.ts' });
    expect(asked[1]!.detail).toContain('2 open files have unsaved changes');
    expect(trashed).toEqual([join(await import('node:fs/promises').then((fs) => fs.realpath(repo)), 'src', 'a.ts')]);
  });

  it('refuses to trash the repo itself, .git, or anything outside', async () => {
    const { repo, ops, asked, trashed } = await setup();
    for (const path of ['', '.git', '../x', '/etc']) {
      expect(await ops.trash(repo, path, 0), path).toEqual({ ok: false, error: 'File is outside the repository' });
    }
    expect(asked).toEqual([]);
    expect(trashed).toEqual([]);
  });

  it('reveals a file, a folder or the repo itself in Finder', async () => {
    const { repo, ops, revealed } = await setup();
    expect(await ops.reveal(repo, 'src/a.ts')).toEqual({ ok: true });
    expect(await ops.reveal(repo, '')).toEqual({ ok: true });
    expect(revealed[0]!.endsWith('/src/a.ts')).toBe(true);
    expect(revealed[1]).toBe(repo);
    expect(await ops.reveal(repo, 'gone')).toEqual({ ok: false, error: 'The file or folder no longer exists' });
  });

  it('the context menu answers with the chosen action', async () => {
    const { ops } = await setup();
    expect(await ops.menu('file')).toBe('rename');
    expect(await ops.menu('nonsense')).toBeNull();
  });
});

describe('menuItems', () => {
  it('folders can get new entries; files and folders can be renamed or trashed; everything can be revealed', () => {
    const labels = (kind: 'repo' | 'dir' | 'file') => menuItems(kind).map((item) => item.label);
    expect(labels('repo')).toEqual(['New File…', 'New Folder…', '-', 'Reveal in Finder']);
    expect(labels('dir')).toEqual(['New File…', 'New Folder…', '-', 'Rename…', 'Move to Trash', '-', 'Reveal in Finder']);
    expect(labels('file')).toEqual(['Rename…', 'Move to Trash', '-', 'Reveal in Finder']);
  });
});
