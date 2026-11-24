import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    getState: () => new Promise(() => undefined),
    claudeUsage: () => new Promise(() => undefined),
    setLayout: vi.fn(),
    setUnsaved: vi.fn(),
    confirmDiscard: vi.fn(async () => true),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp } = await import('../../src/renderer/store');
const { EMPTY_CENTER, tabId } = await import('../../src/renderer/center/tabs');

const file = (path: string) => ({ kind: 'file' as const, repoPath: '/w/app', path });
const id = (path: string) => tabId(file(path));

beforeEach(() => {
  useApp.setState({ center: EMPTY_CENTER, unsaved: {} });
  bridge.edi.setUnsaved.mockClear();
  bridge.edi.confirmDiscard.mockReset().mockResolvedValue(true);
});

describe('unsaved tabs', () => {
  it('the first edit pins a preview tab, so a single click elsewhere does not replace it', () => {
    const { openInCenter, setUnsaved } = useApp.getState();
    openInCenter(file('src/a.ts'), false);
    setUnsaved(id('src/a.ts'), true);
    expect(useApp.getState().center.tabs).toMatchObject([{ id: id('src/a.ts'), pinned: true }]);
    openInCenter(file('src/b.ts'), false);
    expect(useApp.getState().center.tabs.map((tab) => tab.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('tells the main process how many files have unsaved edits, only when the count changes', () => {
    const { openInCenter, setUnsaved } = useApp.getState();
    openInCenter(file('a.ts'), true);
    openInCenter(file('b.ts'), true);
    setUnsaved(id('a.ts'), true);
    setUnsaved(id('a.ts'), true);
    setUnsaved(id('b.ts'), true);
    setUnsaved(id('a.ts'), false);
    expect(bridge.edi.setUnsaved.mock.calls).toEqual([[1], [2], [1]]);
  });

  it('closing a tab with unsaved edits asks first; Cancel keeps it', async () => {
    const { openInCenter, setUnsaved, closeCenterTab } = useApp.getState();
    openInCenter(file('src/app.ts'), true);
    setUnsaved(id('src/app.ts'), true);
    bridge.edi.confirmDiscard.mockResolvedValueOnce(false);
    await closeCenterTab(id('src/app.ts'));
    expect(bridge.edi.confirmDiscard).toHaveBeenCalledWith('app.ts');
    expect(useApp.getState().center.tabs).toHaveLength(1);
    await closeCenterTab(id('src/app.ts'));
    expect(useApp.getState().center.tabs).toHaveLength(0);
    expect(useApp.getState().unsaved).toEqual({});
    expect(bridge.edi.setUnsaved).toHaveBeenLastCalledWith(0);
  });

  it('a clean tab closes without asking', async () => {
    const { openInCenter, closeCenterTab } = useApp.getState();
    openInCenter(file('a.ts'), true);
    await closeCenterTab(id('a.ts'));
    expect(bridge.edi.confirmDiscard).not.toHaveBeenCalled();
    expect(useApp.getState().center.tabs).toHaveLength(0);
  });

  it('tabs that close some other way (folder change) drop their unsaved mark', () => {
    const { openInCenter, setUnsaved } = useApp.getState();
    openInCenter(file('a.ts'), true);
    setUnsaved(id('a.ts'), true);
    useApp.setState({ center: EMPTY_CENTER });
    expect(useApp.getState().unsaved).toEqual({});
    expect(bridge.edi.setUnsaved).toHaveBeenLastCalledWith(0);
  });

  it('ignores a mark for a tab that is not open', () => {
    useApp.getState().setUnsaved(id('gone.ts'), true);
    expect(useApp.getState().unsaved).toEqual({});
    expect(bridge.edi.setUnsaved).not.toHaveBeenCalled();
  });
});
