import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
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
  const clipboard: string[] = [];
  let answer = true;
  const offered: string[] = [];
  let chosen: string | null = null;
  const ops = new FileOps(ws, {
    ask: async (question) => {
      asked.push(question);
      return answer;
    },
    trash: async (target) => {
      trashed.push(target);
    },
    reveal: (target) => revealed.push(target),
    copyToClipboard: (target) => clipboard.push(target),
    menu: async () => 'rename',
    choosePath: async (defaultPath) => {
      offered.push(defaultPath);
      return chosen;
    },
  });
  return {
    dir,
    repo,
    ws,
    ops,
    asked,
    trashed,
    revealed,
    clipboard,
    offered,
    answer: (yes: boolean) => (answer = yes),
    choose: (path: string | null) => (chosen = path),
  };
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
    expect(asked[0]!.message).toBe('Delete "src"?');
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

describe('FileOps.saveNew', () => {
  it('offers the Save panel in the suggested repo and writes the text there', async () => {
    const { repo, ops, offered, choose } = await setup();
    choose(join(repo, 'src', 'notes.md'));
    expect(await ops.saveNew('hello\n', repo)).toEqual({ ok: true, repoPath: repo, path: 'src/notes.md' });
    expect(offered).toEqual([join(repo, 'Untitled.txt')]);
    expect(await readFile(join(repo, 'src', 'notes.md'), 'utf8')).toBe('hello\n');
  });

  it('starts in the open folder when the suggestion is not a repo; Cancel writes nothing', async () => {
    const { dir, ops, offered } = await setup();
    expect(await ops.saveNew('x', '/elsewhere')).toEqual({ ok: false, error: '', cancelled: true });
    expect(offered).toEqual([join(dir, 'Untitled.txt')]);
  });

  it('refuses a place outside every repo, inside .git, and an existing file', async () => {
    const { dir, repo, ops, choose } = await setup();
    choose(join(dir, 'loose.txt'));
    expect(await ops.saveNew('x', repo)).toEqual({ ok: false, error: 'Save it inside one of the repositories in this folder' });
    expect(await exists(join(dir, 'loose.txt'))).toBe(false);
    choose(join(repo, '.git', 'x'));
    expect(await ops.saveNew('x', repo)).toEqual({ ok: false, error: 'File is outside the repository' });
    choose(join(repo, 'src', 'a.ts'));
    expect(await ops.saveNew('x', repo)).toEqual({ ok: false, error: 'A file or folder named a.ts already exists' });
    expect(await readFile(join(repo, 'src', 'a.ts'), 'utf8')).toBe('a\n');
  });

  it('refuses text that is not a string or too large', async () => {
    const { repo, ops, offered } = await setup();
    expect(await ops.saveNew(7, repo)).toEqual({ ok: false, error: 'Invalid text' });
    expect(await ops.saveNew('x'.repeat(5 * 1_048_576 + 1), repo)).toEqual({ ok: false, error: 'The text is too large to save' });
    expect(offered).toEqual([]);
  });
});

describe('menuItems', () => {
  const labels = (kind: 'repo' | 'dir' | 'file', canPaste = false) => menuItems(kind, canPaste).map((item) => item.label);

  it('a file: open in an editor, its history, copy it or its path, rename, duplicate, delete, reveal', () => {
    expect(labels('file')).toEqual([
      'Open in',
      'File History',
      '-',
      'Copy',
      'Copy Path',
      'Copy Relative Path',
      '-',
      'Rename…',
      'Duplicate',
      'Delete',
      '-',
      'Reveal in Finder',
    ]);
    const openIn = menuItems('file')[0]!;
    expect(openIn.submenu?.map((item) => item.id)).toEqual(['openIn:antigravity', 'openIn:zed']);
    expect(menuItems('file').find((item) => item.id === 'trash')).toMatchObject({ label: 'Delete', accelerator: 'Command+Backspace' });
  });

  it('a folder and a repo: new entries, a terminal there, paste only once something was copied', () => {
    expect(labels('dir')).toEqual([
      'New File…',
      'New Folder…',
      '-',
      'New Terminal Here',
      '-',
      'Copy',
      'Paste',
      'Copy Path',
      'Copy Relative Path',
      '-',
      'Rename…',
      'Delete',
      '-',
      'Reveal in Finder',
    ]);
    expect(labels('repo')).toEqual(['New File…', 'New Folder…', '-', 'New Terminal Here', '-', 'Paste', 'Copy Path', '-', 'Reveal in Finder']);
    const paste = (kind: 'repo' | 'dir', canPaste: boolean) => menuItems(kind, canPaste).find((item) => item.id === 'paste')?.enabled;
    expect(paste('dir', false)).toBe(false);
    expect(paste('repo', true)).toBe(true);
  });
});

describe('FileOps copy, paste and duplicate', () => {
  it('pastes what was copied, under its own name or "name copy"; never replaces', async () => {
    const { repo, ops, clipboard } = await setup();
    expect(await ops.paste(repo, '')).toEqual({ ok: false, error: 'Copy a file or folder first' });
    expect(await ops.copy(repo, 'src/a.ts')).toEqual({ ok: true, path: 'src/a.ts' });
    expect(clipboard).toEqual([join(await realpath(repo), 'src', 'a.ts')]);

    expect(await ops.paste(repo, '')).toEqual({ ok: true, path: 'a.ts' });
    expect(await readFile(join(repo, 'a.ts'), 'utf8')).toBe('a\n');
    expect(await ops.paste(repo, '')).toEqual({ ok: true, path: 'a copy.ts' });
    expect(await ops.paste(repo, '')).toEqual({ ok: true, path: 'a copy 2.ts' });
    expect(await readFile(join(repo, 'a.ts'), 'utf8')).toBe('a\n');
  });

  it('duplicates a file or a folder beside it, and does not copy a folder into itself', async () => {
    const { repo, ops } = await setup();
    expect(await ops.duplicate(repo, 'src/a.ts')).toEqual({ ok: true, path: 'src/a copy.ts' });
    expect(await ops.duplicate(repo, 'src')).toEqual({ ok: true, path: 'src copy' });
    expect(await readFile(join(repo, 'src copy', 'a.ts'), 'utf8')).toBe('a\n');
    await ops.copy(repo, 'src');
    expect(await ops.paste(repo, 'src')).toEqual({ ok: false, error: 'A folder cannot be copied into itself' });
    expect(await ops.paste(repo, '../x')).toEqual({ ok: false, error: 'File is outside the repository' });
    expect(await ops.duplicate(repo, '.git')).toEqual({ ok: false, error: 'File is outside the repository' });
    expect(await ops.copy('/elsewhere', 'src/a.ts')).toEqual(UNKNOWN);
  });

  it('a deleted file asks with Delete and says it has uncommitted changes', async () => {
    const { repo, ops, asked, ws } = await setup();
    await writeFile(join(repo, 'src', 'a.ts'), 'changed\n');
    await ws.refresh(repo);
    await ops.trash(repo, 'src/a.ts', 0);
    expect(asked.at(-1)).toMatchObject({ message: 'Delete "a.ts"?', buttons: ['Delete', 'Cancel'] });
    expect(asked.at(-1)!.detail).toContain("It has changes that aren't committed.");
  });
});
