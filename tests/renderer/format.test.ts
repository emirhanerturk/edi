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
});

describe('tildify', () => {
  it('ev klasörünü ~ ile kısaltır', () => {
    expect(tildify('/Users/x/studios/q', '/Users/x')).toBe('~/studios/q');
    expect(tildify('/Users/x', '/Users/x')).toBe('~');
  });
  it('ev klasörüyle yalnız adı başlayan yolu kısaltmaz', () => {
    expect(tildify('/Users/xy/a', '/Users/x')).toBe('/Users/xy/a');
    expect(tildify('/opt/a', '/Users/x')).toBe('/opt/a');
  });
});

describe('plural', () => {
  it('sayıya göre tekil ya da çoğul yazar', () => {
    expect(plural(1, 'repository', 'repositories')).toBe('1 repository');
    expect(plural(0, 'repository', 'repositories')).toBe('0 repositories');
    expect(plural(8, 'repository', 'repositories')).toBe('8 repositories');
  });
});

describe('summary', () => {
  it('değişikliği olan ve gönderilecek commit\'i olan repoları sayar', () => {
    const file = { path: 'a', origPath: null, x: '.', y: 'M', kind: 'changed' as const };
    const view: WorkspaceView = {
      dir: '/w',
      rootSessions: 0,
      refreshedAt: 0,
      repos: [
        repo('temiz', status()),
        repo('degisik', status({ files: [file, { ...file, path: 'b' }] })),
        repo('ileride', status({ ahead: 2, files: [file] })),
        repo('upstreamsiz', status({ upstream: null, ahead: null, behind: null })),
        repo('hatali', null),
      ],
    };
    expect(summary(view)).toEqual({ repos: 5, withChanges: 2, toPush: 1 });
  });
});

describe('ago', () => {
  it('yakın zamanı sabit, eskiyi saniyeyle yazar', () => {
    expect(ago(10_000, 10_500)).toBe('just now');
    expect(ago(10_000, 14_900)).toBe('just now');
    expect(ago(10_000, 22_000)).toBe('12s ago');
    expect(ago(0, 185_000)).toBe('3m ago');
  });
});
