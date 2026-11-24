import { describe, expect, it } from 'vitest';
import {
  type CenterState,
  type CenterTarget,
  EMPTY_CENTER,
  activateCenterTab,
  closeCenterTab,
  moveFileTabs,
  openTarget,
  pinCenterTab,
  setPanelOpen,
  syncCenter,
  tabId,
} from '../../src/renderer/center/tabs';

const diff = (path: string, repoPath = '/w/a'): CenterTarget => ({ kind: 'diff', repoPath, path });
const file = (path: string, repoPath = '/w/a'): CenterTarget => ({ kind: 'file', repoPath, path });
const brief = (s: CenterState) => s.tabs.map((t) => `${t.kind}:${t.path}${t.pinned ? '*' : ''}${t.id === s.active ? '<' : ''}`);

describe('openTarget', () => {
  it('the first click opens the panel and creates a preview tab', () => {
    const s = openTarget(EMPTY_CENTER, diff('a.ts'), false);
    expect(s.open).toBe(true);
    expect(brief(s)).toEqual(['diff:a.ts<']);
    expect(s.active).toBe(tabId(diff('a.ts')));
  });

  it('a second single click reuses the same preview tab', () => {
    const s = openTarget(openTarget(EMPTY_CENTER, diff('a.ts'), false), diff('b.ts'), false);
    expect(brief(s)).toEqual(['diff:b.ts<']);
  });

  it('a double-click pins the tab; the next single click opens a new tab', () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), true);
    expect(brief(s)).toEqual(['diff:a.ts*<']);
    s = openTarget(s, diff('b.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts<']);
    s = openTarget(s, diff('c.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:c.ts<']);
  });

  it('the preview tab is replaced in place, not moved to the end', () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), false);
    s = openTarget(s, diff('b.ts'), true);
    // a was the preview: b took its place and was pinned.
    expect(brief(s)).toEqual(['diff:b.ts*<']);
    s = openTarget(s, diff('c.ts'), false);
    s = openTarget(s, diff('d.ts'), true);
    s = openTarget(s, diff('e.ts'), false);
    s = activateCenterTab(s, tabId(diff('b.ts')));
    s = openTarget(s, diff('f.ts'), false);
    expect(brief(s)).toEqual(['diff:b.ts*', 'diff:d.ts*', 'diff:f.ts<']);
  });

  it('clicking something already open switches to its tab; a double-click pins it', () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), true);
    s = openTarget(s, diff('b.ts'), false);
    s = openTarget(s, diff('a.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*<', 'diff:b.ts']);
    s = openTarget(s, diff('b.ts'), true);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts*<']);
    // A single click does not turn a pinned tab back into a preview.
    s = openTarget(s, diff('b.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts*<']);
  });

  it("a file's diff and its content are separate tabs, and so is the same path in another repo", () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), true);
    s = openTarget(s, file('a.ts'), true);
    s = openTarget(s, file('a.ts', '/w/b'), true);
    expect(s.tabs).toHaveLength(3);
    expect(new Set(s.tabs.map((t) => t.id)).size).toBe(3);
  });
});

describe('closeCenterTab', () => {
  const three = () => [diff('a.ts'), diff('b.ts'), diff('c.ts')].reduce((s, t) => openTarget(s, t, true), EMPTY_CENTER);

  it('closing the active tab brings forward the tab to its right, else the one to its left', () => {
    let s = activateCenterTab(three(), tabId(diff('b.ts')));
    s = closeCenterTab(s, tabId(diff('b.ts')));
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:c.ts*<']);
    s = closeCenterTab(s, tabId(diff('c.ts')));
    expect(brief(s)).toEqual(['diff:a.ts*<']);
  });

  it('closing a background tab keeps the active tab', () => {
    const s = closeCenterTab(three(), tabId(diff('a.ts')));
    expect(brief(s)).toEqual(['diff:b.ts*', 'diff:c.ts*<']);
  });

  it('closing the last tab closes the panel', () => {
    const s = closeCenterTab(openTarget(EMPTY_CENTER, diff('a.ts'), false), tabId(diff('a.ts')));
    expect(s).toEqual(EMPTY_CENTER);
  });

  it('leaves the state unchanged for a missing tab', () => {
    const s = three();
    expect(closeCenterTab(s, 'missing')).toBe(s);
    expect(activateCenterTab(s, 'missing')).toBe(s);
    expect(pinCenterTab(s, 'missing')).toBe(s);
  });
});

describe('panel', () => {
  it('closing it keeps the tabs; clicking something brings it back with the old ones', () => {
    let s = openTarget(openTarget(EMPTY_CENTER, diff('a.ts'), true), diff('b.ts'), true);
    s = setPanelOpen(s, false);
    expect(s.open).toBe(false);
    expect(s.tabs).toHaveLength(2);
    s = openTarget(s, diff('c.ts'), false);
    expect(s.open).toBe(true);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts*', 'diff:c.ts<']);
  });

  it('cannot open without tabs', () => {
    expect(setPanelOpen(EMPTY_CENTER, true)).toEqual(EMPTY_CENTER);
  });

  it('pinCenterTab pins the preview', () => {
    const s = pinCenterTab(openTarget(EMPTY_CENTER, diff('a.ts'), false), tabId(diff('a.ts')));
    expect(brief(s)).toEqual(['diff:a.ts*<']);
  });
});

describe('syncCenter', () => {
  const s = () => {
    let state = openTarget(EMPTY_CENTER, diff('a.ts', '/w/a'), true);
    state = openTarget(state, diff('b.ts', '/w/b'), true);
    return openTarget(state, file('c.ts', '/w/a'), true);
  };

  it('changing the folder closes every tab', () => {
    expect(syncCenter(s(), '/w', '/other', ['/w/a', '/w/b'])).toEqual(EMPTY_CENTER);
    expect(syncCenter(s(), '/w', null, [])).toEqual(EMPTY_CENTER);
  });

  it("a vanished repo's tabs close and the active tab is corrected", () => {
    const next = syncCenter(s(), '/w', '/w', ['/w/b']);
    expect(brief(next)).toEqual(['diff:b.ts*<']);
    expect(next.open).toBe(true);
  });

  it('the panel closes when no tabs remain', () => {
    expect(syncCenter(s(), '/w', '/w', [])).toEqual(EMPTY_CENTER);
  });

  it('returns the same object when nothing changed', () => {
    const state = s();
    expect(syncCenter(state, '/w', '/w', ['/w/a', '/w/b', '/w/c'])).toBe(state);
  });
});

describe('commit tabs', () => {
  const commit = (oid: string, repoPath = '/w/a'): CenterTarget => ({ kind: 'commit', repoPath, path: oid });

  it('preview, pin and close rules are the same; not confused with a file at the same path', () => {
    let s = openTarget(EMPTY_CENTER, commit('a'.repeat(40)), false);
    s = openTarget(s, commit('b'.repeat(40)), false);
    expect(brief(s)).toEqual([`commit:${'b'.repeat(40)}<`]);
    s = openTarget(s, commit('b'.repeat(40)), true);
    s = openTarget(s, file('b'.repeat(40)), false);
    expect(brief(s)).toEqual([`commit:${'b'.repeat(40)}*`, `file:${'b'.repeat(40)}<`]);
    s = closeCenterTab(s, tabId(file('b'.repeat(40))));
    s = closeCenterTab(s, tabId(commit('b'.repeat(40))));
    expect(s.open).toBe(false);
  });

  it('a commit tab closes too when its repo vanishes', () => {
    const s = openTarget(EMPTY_CENTER, commit('a'.repeat(40), '/w/gone'), true);
    expect(syncCenter(s, '/w', '/w', ['/w/a']).tabs).toEqual([]);
  });
});

describe('moveFileTabs', () => {
  const file = (path: string, repoPath = '/r'): CenterTarget => ({ kind: 'file', repoPath, path });
  const start = () => {
    let s = openTarget(EMPTY_CENTER, file('src/a.ts'), true);
    s = openTarget(s, file('src/deep/b.ts'), true);
    s = openTarget(s, { kind: 'diff', repoPath: '/r', path: 'src/a.ts' }, true);
    s = openTarget(s, file('srcx/c.ts'), true);
    s = openTarget(s, file('src/a.ts', '/other'), true);
    return activateCenterTab(s, tabId(file('src/deep/b.ts')));
  };

  it('a renamed folder moves the file tabs inside it, in place; the active one stays active', () => {
    const s = moveFileTabs(start(), '/r', 'src', 'lib');
    expect(s.tabs.map((tab) => tab.id)).toEqual([
      tabId(file('lib/a.ts')),
      tabId(file('lib/deep/b.ts')),
      'diff:/r:src/a.ts',
      tabId(file('srcx/c.ts')),
      tabId(file('src/a.ts', '/other')),
    ]);
    expect(s.tabs[1]).toMatchObject({ path: 'lib/deep/b.ts', pinned: true });
    expect(s.active).toBe(tabId(file('lib/deep/b.ts')));
  });

  it('a deleted file or folder closes its file tabs', () => {
    const s = moveFileTabs(start(), '/r', 'src', null);
    expect(s.tabs.map((tab) => tab.id)).toEqual(['diff:/r:src/a.ts', tabId(file('srcx/c.ts')), tabId(file('src/a.ts', '/other'))]);
    expect(s.active).toBe('diff:/r:src/a.ts');
  });

  it('a rename onto an open tab of the same file keeps one tab', () => {
    let s = openTarget(EMPTY_CENTER, file('a.ts'), true);
    s = openTarget(s, file('A.ts'), true);
    s = moveFileTabs(s, '/r', 'a.ts', 'A.ts');
    expect(s.tabs.map((tab) => tab.path)).toEqual(['A.ts']);
  });
});
