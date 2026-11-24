import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type FileChange,
  getStatus,
  hasUnstaged,
  isDeleted,
  isStaged,
  parseStatus,
  statusLetter,
} from '../src/git/status.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const H = '587be6b4c3f93f93c489c0111bba5596147a26cb';
const hdr = '# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head main\0';
const file = (x: string, y: string, kind: FileChange['kind'] = 'changed'): FileChange => ({
  path: 'p',
  origPath: null,
  x,
  y,
  kind,
});

describe('parseStatus', () => {
  it('reads the upstream and ahead/behind counts', () => {
    expect(parseStatus(`${hdr}# branch.upstream origin/main\0# branch.ab +1 -2\0`)).toEqual({
      head: 'main',
      headOid: 'c8be86ca35d2184906225ab667c0025a8abfc51c',
      detached: false,
      unborn: false,
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      stashes: 0,
      files: [],
    });
  });

  it('reads the stash count (--show-stash)', () => {
    expect(parseStatus(`${hdr}# stash 3\0`).stashes).toBe(3);
    expect(parseStatus(hdr).stashes).toBe(0);
  });

  it('leaves ahead/behind unknown without an upstream', () => {
    expect(parseStatus(hdr)).toMatchObject({ upstream: null, ahead: null, behind: null });
  });

  it('leaves ahead/behind unknown when the upstream was deleted (no branch.ab)', () => {
    expect(parseStatus(`${hdr}# branch.upstream origin/gone\0`)).toMatchObject({
      upstream: 'origin/gone',
      ahead: null,
      behind: null,
    });
  });

  it('returns the short hash for a detached HEAD', () => {
    expect(
      parseStatus('# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head (detached)\0'),
    ).toMatchObject({ head: 'c8be86c', detached: true });
  });

  it('recognizes a repo without commits', () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({
      head: 'main',
      unborn: true,
      detached: false,
    });
  });

  it('consumes the original path field of a rename entry', () => {
    const s = parseStatus(`${hdr}2 R. N... 100644 100644 100644 ${H} ${H} R100 new.txt\0boş dosya.txt\0? unt.txt\0`);
    expect(s.files).toEqual([
      { path: 'new.txt', origPath: 'boş dosya.txt', x: 'R', y: '.', kind: 'changed' },
      { path: 'unt.txt', origPath: null, x: '?', y: '?', kind: 'untracked' },
    ]);
  });

  it('leaves origPath empty for a copy entry and keeps the next entry intact', () => {
    const s = parseStatus(`${hdr}2 C. N... 100644 100644 100644 ${H} ${H} C100 copy.txt\0source.txt\0? unt.txt\0`);
    expect(s.files).toEqual([
      { path: 'copy.txt', origPath: null, x: 'C', y: '.', kind: 'changed' },
      { path: 'unt.txt', origPath: null, x: '?', y: '?', kind: 'untracked' },
    ]);
  });

  it('does not split a path with spaces', () => {
    const s = parseStatus(`${hdr}1 .M N... 100644 100644 100644 ${H} ${H} a b/c d.txt\0`);
    expect(s.files).toEqual([{ path: 'a b/c d.txt', origPath: null, x: '.', y: 'M', kind: 'changed' }]);
  });

  it('recognizes a conflicted entry', () => {
    const s = parseStatus(`${hdr}u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} x y.txt\0`);
    expect(s.files).toEqual([{ path: 'x y.txt', origPath: null, x: 'U', y: 'U', kind: 'conflicted' }]);
  });

  it('skips ignored (!) entries', () => {
    expect(parseStatus(`${hdr}! node_modules/\0? a.txt\0`).files.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('does not crash on empty output', () => {
    expect(parseStatus('')).toMatchObject({ head: '', files: [] });
  });
});

describe('file helpers', () => {
  it('tells staged from unstaged', () => {
    expect([isStaged(file('.', 'M')), hasUnstaged(file('.', 'M'))]).toEqual([false, true]);
    expect([isStaged(file('M', '.')), hasUnstaged(file('M', '.'))]).toEqual([true, false]);
    expect([isStaged(file('A', 'M')), hasUnstaged(file('A', 'M'))]).toEqual([true, true]);
    expect([isStaged(file('?', '?', 'untracked')), hasUnstaged(file('?', '?', 'untracked'))]).toEqual([false, true]);
    expect([isStaged(file('U', 'U', 'conflicted')), hasUnstaged(file('U', 'U', 'conflicted'))]).toEqual([
      false,
      false,
    ]);
  });

  it('recognizes a deleted file', () => {
    expect(isDeleted(file('.', 'D'))).toBe(true);
    expect(isDeleted(file('D', '.'))).toBe(true);
    expect(isDeleted(file('M', '.'))).toBe(false);
    expect(isDeleted(file('?', '?', 'untracked'))).toBe(false);
  });

  it('produces the status letter', () => {
    expect(statusLetter(file('.', 'M'))).toBe('M');
    expect(statusLetter(file('M', '.'))).toBe('M');
    expect(statusLetter(file('A', 'M'))).toBe('M');
    expect(statusLetter(file('?', '?', 'untracked'))).toBe('?');
    expect(statusLetter(file('U', 'U', 'conflicted'))).toBe('U');
  });

  it('has a null headOid in a repo without commits', () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ unborn: true, headOid: null });
  });

  it('returns the full oid on a detached HEAD too', () => {
    expect(parseStatus('# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head (detached)\0')).toMatchObject({
      detached: true,
      head: 'c8be86c',
      headOid: 'c8be86ca35d2184906225ab667c0025a8abfc51c',
    });
  });
});

describe('getStatus', () => {
  it('lists new files one by one rather than as a folder', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'd'));
    await writeFile(join(repo, 'd', 'n.txt'), 'x\n');
    await writeFile(join(repo, 'boş dosya.txt'), 'x\n');

    const r = await getStatus(repo);
    expect(r.ok && r.status.files.map((f) => f.path).sort()).toEqual(['boş dosya.txt', 'd/n.txt']);
  });

  it('tells staged, modified and new files apart', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'README.md'), 'changed\n');
    await writeFile(join(repo, 'staged.txt'), 'x\n');
    await git(repo, 'add', 'staged.txt');
    await writeFile(join(repo, 'new.txt'), 'x\n');

    const r = await getStatus(repo);
    const byPath = Object.fromEntries((r.ok ? r.status.files : []).map((f) => [f.path, `${f.x}${f.y}`]));
    expect(byPath).toEqual({ 'README.md': '.M', 'staged.txt': 'A.', 'new.txt': '??' });
  });

  it('counts the stashes', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const count = async () => {
      const r = await getStatus(repo);
      return r.ok ? r.status.stashes : -1;
    };
    expect(await count()).toBe(0);
    for (const n of [1, 2]) {
      await writeFile(join(repo, 'README.md'), `change ${n}\n`);
      await git(repo, 'stash', '-q');
    }
    expect(await count()).toBe(2);
  });

  it('works in a repo without commits', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await writeFile(join(repo, 'first.txt'), 'x\n');
    const r = await getStatus(repo);
    expect(r).toMatchObject({ ok: true, status: { head: 'main', unborn: true, files: [{ path: 'first.txt' }] } });
  });

  it('returns an error for a missing path', async () => {
    expect((await getStatus('/no/such/place')).ok).toBe(false);
  });
});
