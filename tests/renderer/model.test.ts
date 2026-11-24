import { describe, expect, it } from 'vitest';
import type { FileChange, RepoStatus } from '../../src/git/types';
import {
  changeCount,
  commitTarget,
  groupFiles,
  isDeletion,
  isPartlyStaged,
  letter,
  letterColor,
  splitPath,
  syncAction,
} from '../../src/renderer/git/model';

const status = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  head: 'main',
  headOid: 'a'.repeat(40),
  detached: false,
  unborn: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  files: [],
  ...over,
});
const file = (path: string, x: string, y: string, kind: FileChange['kind'] = 'changed'): FileChange => ({
  path,
  origPath: null,
  x,
  y,
  kind,
});

describe('syncAction', () => {
  it('eşitken düğme yok', () => {
    expect(syncAction(status())).toBeNull();
  });
  it('gerideyse Pull', () => {
    expect(syncAction(status({ behind: 2 }))).toEqual({ kind: 'pull', label: 'Pull 2' });
  });
  it('yalnız ilerideyse Push', () => {
    expect(syncAction(status({ ahead: 1 }))).toEqual({ kind: 'push', label: 'Push 1' });
  });
  it('hem ileride hem gerideyse Pull', () => {
    expect(syncAction(status({ ahead: 3, behind: 1 }))).toEqual({ kind: 'pull', label: 'Pull 1' });
  });
  it("upstream yoksa ya da silinmişse Publish branch", () => {
    expect(syncAction(status({ upstream: null, ahead: null, behind: null }))).toEqual({ kind: 'publish', label: 'Publish branch' });
    expect(syncAction(status({ upstream: 'origin/feat', ahead: null, behind: null }))).toEqual({
      kind: 'publish',
      label: 'Publish branch',
    });
  });
  it("remote'u olmayan repoda yayınlanacak yer yoktur: düğme yok", () => {
    expect(syncAction(status({ upstream: null, ahead: null, behind: null }), false)).toBeNull();
    expect(syncAction(status({ ahead: 1 }), false)).toEqual({ kind: 'push', label: 'Push 1' });
  });
  it("commit'siz repoda ve detached HEAD'de düğme yok", () => {
    expect(syncAction(status({ unborn: true, headOid: null, upstream: null, ahead: null, behind: null }))).toBeNull();
    expect(syncAction(status({ detached: true, upstream: null, ahead: null, behind: null }))).toBeNull();
  });
});

describe('groupFiles', () => {
  it('dosyaları Conflicts, Staged ve Changes gruplarına ayırır', () => {
    const files = [
      file('a.ts', 'M', '.'),
      file('b.ts', '.', 'M'),
      file('c.ts', 'M', 'M'), // kısmen stage'li: iki grupta da
      file('d.ts', '?', '?', 'untracked'),
      file('e.ts', 'U', 'U', 'conflicted'),
      file('f.ts', 'D', '.'),
    ];
    const groups = groupFiles(status({ files }));
    expect(groups.staged.map((f) => f.path)).toEqual(['a.ts', 'c.ts', 'f.ts']);
    expect(groups.changes.map((f) => f.path)).toEqual(['b.ts', 'c.ts', 'd.ts']);
    expect(groups.conflicts.map((f) => f.path)).toEqual(['e.ts']);
  });

  it('tekil yol sayısını verir', () => {
    expect(changeCount(status({ files: [file('c.ts', 'M', 'M'), file('d.ts', '?', '?', 'untracked')] }))).toBe(2);
  });

  it('kısmen stage\'li dosyayı tanır', () => {
    expect(isPartlyStaged(file('c.ts', 'M', 'M'))).toBe(true);
    expect(isPartlyStaged(file('a.ts', 'M', '.'))).toBe(false);
    expect(isPartlyStaged(file('d.ts', '?', '?', 'untracked'))).toBe(false);
  });
});

describe('letter', () => {
  it('grubuna göre durum harfini verir', () => {
    const partly = file('c.ts', 'A', 'M');
    expect(letter(partly, 'staged')).toBe('A');
    expect(letter(partly, 'changes')).toBe('M');
    expect(letter(file('d.ts', '?', '?', 'untracked'), 'changes')).toBe('?');
    expect(letter(file('e.ts', 'U', 'U', 'conflicted'), 'conflicts')).toBe('U');
    expect(letter(file('r.ts', 'R', '.'), 'staged')).toBe('R');
  });

  it('harfe göre renk verir', () => {
    expect(letterColor('M')).toBe('var(--yellow)');
    expect(letterColor('A')).toBe('var(--green)');
    expect(letterColor('?')).toBe('var(--green)');
    expect(letterColor('D')).toBe('var(--red)');
    expect(letterColor('U')).toBe('var(--red)');
    expect(letterColor('R')).toBe('var(--cyan)');
    expect(letterColor('C')).toBe('var(--cyan)');
    expect(letterColor('T')).toBe('var(--yellow)');
  });

  it('silmeyi grubuna göre tanır', () => {
    expect(isDeletion(file('f.ts', 'D', '.'), 'staged')).toBe(true);
    expect(isDeletion(file('f.ts', '.', 'D'), 'changes')).toBe(true);
    expect(isDeletion(file('f.ts', 'M', 'D'), 'staged')).toBe(false);
  });
});

describe('splitPath', () => {
  it('adı ve klasörü ayırır', () => {
    expect(splitPath('app/game/[gameId]/play.tsx')).toEqual({ name: 'play.tsx', dir: 'app/game/[gameId]' });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' });
  });
});

describe('commitTarget', () => {
  const groups = (staged: number, changes: number, conflicts = 0) => ({
    staged: Array.from({ length: staged }, (_, i) => file(`s${i}`, 'M', '.')),
    changes: Array.from({ length: changes }, (_, i) => file(`c${i}`, '.', 'M')),
    conflicts: Array.from({ length: conflicts }, (_, i) => file(`u${i}`, 'U', 'U', 'conflicted')),
  });

  it("stage'li dosya varsa yalnız onları commit eder", () => {
    expect(commitTarget(groups(3, 4))).toEqual({ all: false, count: 3, label: 'Commit · 3 files', enabled: true });
    expect(commitTarget(groups(1, 0))).toEqual({ all: false, count: 1, label: 'Commit · 1 file', enabled: true });
  });
  it("hiçbir şey stage'li değilse hepsini commit eder", () => {
    expect(commitTarget(groups(0, 2))).toEqual({ all: true, count: 2, label: 'Commit all · 2 files', enabled: true });
  });
  it('değişiklik yoksa pasif', () => {
    expect(commitTarget(groups(0, 0))).toEqual({ all: false, count: 0, label: 'Commit', enabled: false });
  });
  it('çakışma varken pasif', () => {
    expect(commitTarget(groups(0, 2, 1)).enabled).toBe(false);
    expect(commitTarget(groups(1, 0, 1)).enabled).toBe(false);
  });
});
