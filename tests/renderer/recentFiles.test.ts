import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/bridge', () => ({ edi: { setUnsaved: vi.fn() } }));
const { addRecent, useApp } = await import('../../src/renderer/store');

describe('addRecent', () => {
  it('puts a file first, once, and keeps 30', () => {
    let recent = addRecent([], { repoPath: '/w/a', path: 'x.ts' });
    recent = addRecent(recent, { repoPath: '/w/a', path: 'y.ts' });
    recent = addRecent(recent, { repoPath: '/w/a', path: 'x.ts' });
    expect(recent).toEqual([
      { repoPath: '/w/a', path: 'x.ts' },
      { repoPath: '/w/a', path: 'y.ts' },
    ]);
    expect(addRecent(recent, { repoPath: '/w/a', path: 'x.ts' })).toBe(recent);
    for (let n = 0; n < 40; n++) recent = addRecent(recent, { repoPath: '/w/a', path: `${n}.ts` });
    expect(recent).toHaveLength(30);
  });

  it('records the file and diff tabs that come to the front', () => {
    useApp.getState().openInCenter({ kind: 'file', repoPath: '/w/a', path: 'src/a.ts' }, false);
    useApp.getState().openInCenter({ kind: 'commit', repoPath: '/w/a', path: 'f'.repeat(40) }, true);
    useApp.getState().openInCenter({ kind: 'diff', repoPath: '/w/a', path: 'src/b.ts' }, true);
    expect(useApp.getState().recent.slice(0, 2)).toEqual([
      { repoPath: '/w/a', path: 'src/b.ts' },
      { repoPath: '/w/a', path: 'src/a.ts' },
    ]);
  });
});
