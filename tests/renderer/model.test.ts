import { describe, expect, it } from 'vitest';
import type { FileChange, RepoStatus } from '../../src/git/types';
import {
  changeCount,
  fileLetter,
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
  it('no button when in sync', () => {
    expect(syncAction(status())).toBeNull();
  });
  it('Pull when behind', () => {
    expect(syncAction(status({ behind: 2 }))).toEqual({ kind: 'pull', label: 'Pull 2' });
  });
  it('Push when only ahead', () => {
    expect(syncAction(status({ ahead: 1 }))).toEqual({ kind: 'push', label: 'Push 1' });
  });
  it('Pull when both ahead and behind', () => {
    expect(syncAction(status({ ahead: 3, behind: 1 }))).toEqual({ kind: 'pull', label: 'Pull 1' });
  });
  it('Publish branch when the upstream is missing or deleted', () => {
    expect(syncAction(status({ upstream: null, ahead: null, behind: null }))).toEqual({ kind: 'publish', label: 'Publish branch' });
    expect(syncAction(status({ upstream: 'origin/feat', ahead: null, behind: null }))).toEqual({
      kind: 'publish',
      label: 'Publish branch',
    });
  });
  it('no Publish button in a repo without a remote: there is nowhere to publish', () => {
    expect(syncAction(status({ upstream: null, ahead: null, behind: null }), false)).toBeNull();
    expect(syncAction(status({ ahead: 1 }), false)).toEqual({ kind: 'push', label: 'Push 1' });
  });
  it('no button in a repo without commits or on a detached HEAD', () => {
    expect(syncAction(status({ unborn: true, headOid: null, upstream: null, ahead: null, behind: null }))).toBeNull();
    expect(syncAction(status({ detached: true, upstream: null, ahead: null, behind: null }))).toBeNull();
  });
});

describe('groupFiles', () => {
  it('splits files into the Conflicts, Staged and Changes groups', () => {
    const files = [
      file('a.ts', 'M', '.'),
      file('b.ts', '.', 'M'),
      file('c.ts', 'M', 'M'), // partly staged: in both groups
      file('d.ts', '?', '?', 'untracked'),
      file('e.ts', 'U', 'U', 'conflicted'),
      file('f.ts', 'D', '.'),
    ];
    const groups = groupFiles(status({ files }));
    expect(groups.staged.map((f) => f.path)).toEqual(['a.ts', 'c.ts', 'f.ts']);
    expect(groups.changes.map((f) => f.path)).toEqual(['b.ts', 'c.ts', 'd.ts']);
    expect(groups.conflicts.map((f) => f.path)).toEqual(['e.ts']);
  });

  it('counts distinct paths', () => {
    expect(changeCount(status({ files: [file('c.ts', 'M', 'M'), file('d.ts', '?', '?', 'untracked')] }))).toBe(2);
  });

  it('detects a partly staged file', () => {
    expect(isPartlyStaged(file('c.ts', 'M', 'M'))).toBe(true);
    expect(isPartlyStaged(file('a.ts', 'M', '.'))).toBe(false);
    expect(isPartlyStaged(file('d.ts', '?', '?', 'untracked'))).toBe(false);
  });
});

describe('letter', () => {
  it('gives the status letter for the group', () => {
    const partly = file('c.ts', 'A', 'M');
    expect(letter(partly, 'staged')).toBe('A');
    expect(letter(partly, 'changes')).toBe('M');
    expect(letter(file('d.ts', '?', '?', 'untracked'), 'changes')).toBe('?');
    expect(letter(file('e.ts', 'U', 'U', 'conflicted'), 'conflicts')).toBe('U');
    expect(letter(file('r.ts', 'R', '.'), 'staged')).toBe('R');
  });

  it('gives the color for a letter', () => {
    expect(letterColor('M')).toBe('var(--yellow)');
    expect(letterColor('A')).toBe('var(--green)');
    expect(letterColor('?')).toBe('var(--green)');
    expect(letterColor('D')).toBe('var(--red)');
    expect(letterColor('U')).toBe('var(--red)');
    expect(letterColor('R')).toBe('var(--cyan)');
    expect(letterColor('C')).toBe('var(--cyan)');
    expect(letterColor('T')).toBe('var(--yellow)');
  });

  it('detects a deletion per group', () => {
    expect(isDeletion(file('f.ts', 'D', '.'), 'staged')).toBe(true);
    expect(isDeletion(file('f.ts', '.', 'D'), 'changes')).toBe(true);
    expect(isDeletion(file('f.ts', 'M', 'D'), 'staged')).toBe(false);
  });
});

describe('splitPath', () => {
  it('splits the name from the folder', () => {
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

  it('commits only the staged files when there are any', () => {
    expect(commitTarget(groups(3, 4))).toEqual({ all: false, count: 3, label: 'Commit · 3 files', enabled: true });
    expect(commitTarget(groups(1, 0))).toEqual({ all: false, count: 1, label: 'Commit · 1 file', enabled: true });
  });
  it('commits everything when nothing is staged', () => {
    expect(commitTarget(groups(0, 2))).toEqual({ all: true, count: 2, label: 'Commit all · 2 files', enabled: true });
  });
  it('disabled when there are no changes', () => {
    expect(commitTarget(groups(0, 0))).toEqual({ all: false, count: 0, label: 'Commit', enabled: false });
  });
  it('disabled while there are conflicts', () => {
    expect(commitTarget(groups(0, 2, 1)).enabled).toBe(false);
    expect(commitTarget(groups(1, 0, 1)).enabled).toBe(false);
  });
});

describe('fileLetter', () => {
  const change = (x: string, y: string, kind: FileChange['kind'] = 'changed'): FileChange => ({ path: 'p', origPath: null, x, y, kind });

  it('gives the working tree status, else the staged status', () => {
    expect(fileLetter(change('.', 'M'))).toBe('M');
    expect(fileLetter(change('A', '.'))).toBe('A');
    expect(fileLetter(change('A', 'M'))).toBe('M');
    expect(fileLetter(change('R', '.'))).toBe('R');
    expect(fileLetter(change('.', 'D'))).toBe('D');
  });

  it('a new file is ? and a conflict is U', () => {
    expect(fileLetter(change('?', '?', 'untracked'))).toBe('?');
    expect(fileLetter(change('U', 'U', 'conflicted'))).toBe('U');
  });
});
