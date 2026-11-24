import { describe, expect, it } from 'vitest';
import { ago, plural, summary, tildify } from '../../src/renderer/format';
import type { RepoStatus } from '../../src/git/types';
import type { RepoView, WorkspaceView } from '../../src/shared/api';

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
const repo = (name: string, s: RepoStatus | null): RepoView => ({
  name,
  path: `/w/${name}`,
  status: s,
  error: s ? null : 'x',
  busy: null,
  claude: 0,
  hasRemote: true,
});

describe('tildify', () => {
  it('shortens the home folder to ~', () => {
    expect(tildify('/Users/x/studios/q', '/Users/x')).toBe('~/studios/q');
    expect(tildify('/Users/x', '/Users/x')).toBe('~');
  });
  it('does not shorten a path that only starts with the home folder name', () => {
    expect(tildify('/Users/xy/a', '/Users/x')).toBe('/Users/xy/a');
    expect(tildify('/opt/a', '/Users/x')).toBe('/opt/a');
  });
});

describe('plural', () => {
  it('writes singular or plural by count', () => {
    expect(plural(1, 'repository', 'repositories')).toBe('1 repository');
    expect(plural(0, 'repository', 'repositories')).toBe('0 repositories');
    expect(plural(8, 'repository', 'repositories')).toBe('8 repositories');
  });
});

describe('summary', () => {
  it('counts repos with changes and repos with commits to push', () => {
    const file = { path: 'a', origPath: null, x: '.', y: 'M', kind: 'changed' as const };
    const view: WorkspaceView = {
      dir: '/w',
      rootSessions: 0,
      refreshedAt: 0,
      repos: [
        repo('clean', status()),
        repo('changed', status({ files: [file, { ...file, path: 'b' }] })),
        repo('ahead', status({ ahead: 2, files: [file] })),
        repo('no-upstream', status({ upstream: null, ahead: null, behind: null })),
        repo('broken', null),
      ],
    };
    expect(summary(view)).toEqual({ repos: 5, withChanges: 2, toPush: 1 });
  });
});

describe('ago', () => {
  it('a fixed phrase for recent times, an exact age for older ones', () => {
    expect(ago(10_000, 10_500)).toBe('just now');
    expect(ago(10_000, 14_900)).toBe('just now');
    expect(ago(10_000, 22_000)).toBe('12s ago');
    expect(ago(0, 185_000)).toBe('3m ago');
  });
});
