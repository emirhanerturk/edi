// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/bridge', () => ({ edi: {} }));
vi.mock('../../src/renderer/terminals/terminals', () => ({}));

const { applyTabStates, applyTitle, removeTab } = await import('../../src/renderer/store');
type Tab = import('../../src/renderer/store').Tab;

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 1,
  title: 'zsh',
  claude: false,
  waiting: false,
  busy: false,
  exited: false,
  claudeUntil: 0,
  titleState: null,
  ...over,
});

describe('applyTabStates', () => {
  it('updates the title, kind and busy state', () => {
    const tabs = [tab(), tab({ id: 2 })];
    const next = applyTabStates(tabs, [{ id: 1, title: 'npm run dev', claude: false, busy: true }], 0);
    expect(next[0]).toMatchObject({ title: 'npm run dev', busy: true });
    expect(next[1]).toBe(tabs[1]); // a tab with no incoming state stays the same object
  });

  it('returns the same object when nothing changed', () => {
    const tabs = [tab()];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toBe(tabs[0]);
  });

  it('leaves an exited tab alone', () => {
    const tabs = [tab({ exited: true, title: 'vim' })];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toBe(tabs[0]);
  });

  it('ignores a "shell only" state while Claude Code starts, and accepts it once the grace period ends', () => {
    const tabs = [tab({ title: 'claude', claude: true, claudeUntil: 5000 })];
    const shell = [{ id: 1, title: 'zsh', claude: false, busy: false }];
    expect(applyTabStates(tabs, shell, 1000)[0]).toBe(tabs[0]);
    expect(applyTabStates(tabs, shell, 6000)[0]).toMatchObject({ title: 'zsh', claude: false });
    // If Claude has really started, there is no wait.
    expect(applyTabStates(tabs, [{ id: 1, title: 'claude', claude: true, busy: true }], 1000)[0]).toMatchObject({ busy: true });
  });

  it('quitting Claude Code clears the waiting mark', () => {
    const tabs = [tab({ title: 'claude', claude: true, waiting: true, busy: true })];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toMatchObject({ waiting: false, claude: false });
    expect(applyTabStates(tabs, [{ id: 1, title: 'claude', claude: true, busy: true }], 0)[0]).toBe(tabs[0]);
  });
});

describe('applyTitle', () => {
  const claudeTab = (over: Partial<Tab> = {}) => tab({ title: 'claude', claude: true, ...over });

  it('the bell rings when a background Claude tab goes from working to waiting', () => {
    const working = applyTitle(claudeTab(), '◐ Task', false);
    expect(working).toMatchObject({ titleState: 'working', waiting: false });
    expect(applyTitle(working, '✳ Task', false)).toMatchObject({ titleState: 'waiting', waiting: true });
  });

  it('no bell on the active tab, nor after later switching to another tab', () => {
    const done = applyTitle(applyTitle(claudeTab(), '◑ Task', true), '✳ Task', true);
    expect(done).toMatchObject({ titleState: 'waiting', waiting: false });
    // Once in the background, a repeat of the same title is not a new event.
    expect(applyTitle(done, '✳ Task', false).waiting).toBe(false);
  });

  it('a freshly opened session that never worked does not ring the bell', () => {
    expect(applyTitle(claudeTab(), '✳ Claude Code', false)).toMatchObject({ titleState: 'waiting', waiting: false });
  });

  it('the bell goes off when work starts again', () => {
    const waiting = claudeTab({ titleState: 'waiting', waiting: true });
    expect(applyTitle(waiting, '◐ Task', false)).toMatchObject({ titleState: 'working', waiting: false });
  });

  it('a title that is not from Claude Code does not change the state', () => {
    const working = claudeTab({ titleState: 'working' });
    expect(applyTitle(working, 'zsh', false)).toBe(working);
    const waiting = claudeTab({ titleState: 'waiting', waiting: true });
    expect(applyTitle(waiting, '', false)).toBe(waiting);
  });

  it('no bell on a tab that is not a Claude tab', () => {
    const working = applyTitle(tab(), '◐ fake', false);
    expect(applyTitle(working, '✳ fake', false).waiting).toBe(false);
  });

  it('leaves an exited tab alone', () => {
    const exited = claudeTab({ exited: true, titleState: 'working' });
    expect(applyTitle(exited, '✳ Task', false)).toBe(exited);
  });
});

describe('applyTabStates and the bell', () => {
  it('closing Claude Code resets the bell and the title state', () => {
    const tabs = [tab({ title: 'claude', claude: true, waiting: true, titleState: 'waiting' })];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toMatchObject({
      claude: false,
      waiting: false,
      titleState: null,
    });
  });
});

describe('removeTab', () => {
  it('closing the active tab brings forward the tab to its right, else the one to its left', () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3 })];
    expect(removeTab(tabs, 2, 2)).toMatchObject({ activeTab: 3, tabs: [{ id: 1 }, { id: 3 }] });
    expect(removeTab(tabs, 3, 3)).toMatchObject({ activeTab: 2 });
    expect(removeTab([tab({ id: 1 })], 1, 1)).toEqual({ tabs: [], activeTab: null });
  });

  it('closing a background tab keeps the active tab', () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2, waiting: true })];
    expect(removeTab(tabs, 1, 2)).toEqual({ tabs: [tabs[0]], activeTab: 1 });
  });

  it('the bell goes off on the tab brought forward: the user is now looking at it', () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2, claude: true, waiting: true, titleState: 'waiting' })];
    const next = removeTab(tabs, 1, 1);
    expect(next.activeTab).toBe(2);
    expect(next.tabs[0]).toMatchObject({ id: 2, waiting: false, titleState: 'waiting' });
  });
});
