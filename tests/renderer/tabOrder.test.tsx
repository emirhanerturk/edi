// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/bridge', () => ({ edi: { on: () => () => undefined, setUnsaved: vi.fn() } }));
vi.mock('../../src/renderer/terminals/terminals', () => ({ showTerminal: vi.fn() }));

const { useApp, moveTab } = await import('../../src/renderer/store');
const { TabBar } = await import('../../src/renderer/terminals/TabBar');
const { dropIndex, dropSide, moveItem } = await import('../../src/renderer/components/tabDrag');
const { CenterTabs } = await import('../../src/renderer/center/CenterTabs');
const { moveCenterTab } = await import('../../src/renderer/center/tabs');
type Tab = import('../../src/renderer/store').Tab;

afterEach(cleanup);

const tab = (id: number, title: string): Tab => ({ id, title, claude: false, waiting: false, busy: false, exited: false, claudeUntil: 0, titleState: null });
const A = tab(1, 'a');
const B = tab(2, 'b');
const C = tab(3, 'c');
const titles = (tabs: Tab[]) => tabs.map((t) => t.title).join('');

describe('moveTab and dropIndex', () => {
  it('drops a tab before or after another', () => {
    const tabs = [A, B, C];
    const ids = [1, 2, 3];
    expect(titles(moveTab(tabs, 1, dropIndex(ids, 1, 2, 'after')))).toBe('bac');
    expect(titles(moveTab(tabs, 3, dropIndex(ids, 3, 1, 'before')))).toBe('cab');
    expect(titles(moveTab(tabs, 2, dropIndex(ids, 2, 3, 'after')))).toBe('acb');
  });

  it('leaves the order alone where the tab already is', () => {
    const tabs = [A, B, C];
    const ids = [1, 2, 3];
    expect(dropIndex(ids, 1, 2, 'before')).toBe(0);
    expect(dropIndex(ids, 1, 1, 'after')).toBe(0);
    expect(moveTab(tabs, 1, 0)).toBe(tabs);
    expect(moveItem(['x'], 3, 0)).toEqual(['x']);
  });

  it('reads the half of the tab under the pointer', () => {
    expect(dropSide(110, { left: 100, width: 60 })).toBe('before');
    expect(dropSide(140, { left: 100, width: 60 })).toBe('after');
  });
});

describe('dragging a tab', () => {
  const dataTransfer = () => ({ setData: vi.fn(), types: ['application/x-edi-tab'], effectAllowed: '', dropEffect: '' });
  /** A dragover at `clientX` over the tab (jsdom's events carry no position of their own). */
  const dragOver = (element: Element, clientX: number, transfer: ReturnType<typeof dataTransfer>) => {
    const event = createEvent.dragOver(element, { dataTransfer: transfer });
    Object.defineProperty(event, 'clientX', { value: clientX });
    fireEvent(element, event);
  };

  beforeEach(() => {
    useApp.setState({ tabs: [A, B, C], activeTab: 1, servers: [] });
  });

  it('marks where the tab will go with a line, and moves it there on drop', () => {
    render(<TabBar />);
    const [first, , third] = screen.getAllByTestId('tab');
    third!.getBoundingClientRect = () => ({ left: 200, width: 80, top: 0, bottom: 36, right: 280, height: 36, x: 200, y: 0, toJSON: () => null });
    const transfer = dataTransfer();
    fireEvent.dragStart(first!, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith('application/x-edi-tab', '1');
    expect(first!.className).toContain('dragging');
    dragOver(third!, 270, transfer);
    expect(third!.className).toContain('drop-after');
    dragOver(third!, 210, transfer);
    expect(third!.className).toContain('drop-before');
    fireEvent.drop(third!, { dataTransfer: transfer });
    expect(titles(useApp.getState().tabs)).toBe('bac');
    expect(screen.getAllByTestId('tab').some((element) => /drop-|dragging/.test(element.className))).toBe(false);
  });

  it('shows no line where the drop would change nothing, and goes to the end past the last tab', () => {
    render(<TabBar />);
    const [first, second] = screen.getAllByTestId('tab');
    second!.getBoundingClientRect = () => ({ left: 100, width: 80, top: 0, bottom: 36, right: 180, height: 36, x: 100, y: 0, toJSON: () => null });
    const transfer = dataTransfer();
    fireEvent.dragStart(first!, { dataTransfer: transfer });
    dragOver(second!, 110, transfer);
    expect(screen.getAllByTestId('tab').some((element) => element.className.includes('drop-'))).toBe(false);
    const spacer = document.querySelector('.tabbar > .spacer')!;
    dragOver(spacer, 600, transfer);
    expect(screen.getAllByTestId('tab')[2]!.className).toContain('drop-after');
    fireEvent.drop(spacer, { dataTransfer: transfer });
    expect(titles(useApp.getState().tabs)).toBe('bca');
  });

  it('a drag that ends elsewhere changes nothing', () => {
    render(<TabBar />);
    const [first, , third] = screen.getAllByTestId('tab');
    const transfer = dataTransfer();
    fireEvent.dragStart(first!, { dataTransfer: transfer });
    dragOver(third!, 999, transfer);
    fireEvent.dragEnd(first!, { dataTransfer: transfer });
    expect(titles(useApp.getState().tabs)).toBe('abc');
    expect(screen.getAllByTestId('tab').some((element) => /drop-|dragging/.test(element.className))).toBe(false);
  });
});

describe('dragging a tab in the center panel', () => {
  const transfer = () => ({ setData: vi.fn(), types: ['application/x-edi-center-tab'], effectAllowed: '', dropEffect: '' });
  const label = (id: string) => ({ id, kind: 'file' as const, name: `${id}.ts`, dir: '', letter: null, pinned: true });

  it('keeps the active tab while the tabs move', () => {
    const state = { tabs: ['a', 'b', 'c'].map((id) => ({ id, kind: 'file' as const, repoPath: '/w', path: id, pinned: true })), active: 'b', open: true };
    const moved = moveCenterTab(state, 'a', 2);
    expect(moved.tabs.map((tab) => tab.id)).toEqual(['b', 'c', 'a']);
    expect(moved.active).toBe('b');
    expect(moveCenterTab(state, 'b', 1)).toBe(state);
  });

  it('marks where the tab will go and reports its new place; a terminal tab is not taken', () => {
    const onMove = vi.fn();
    const handlers = { onActivate: vi.fn(), onPin: vi.fn(), onClose: vi.fn(), onClosePanel: vi.fn() };
    render(<CenterTabs tabs={['a', 'b', 'c'].map(label)} active="a" {...handlers} onMove={onMove} />);
    const [first, , third] = screen.getAllByTestId('center-tab');
    third!.getBoundingClientRect = () => ({ left: 200, width: 80, top: 0, bottom: 36, right: 280, height: 36, x: 200, y: 0, toJSON: () => null });
    // A terminal tab dragged over this bar: no line, no move.
    const foreign = { setData: vi.fn(), types: ['application/x-edi-tab'], effectAllowed: '', dropEffect: '' };
    const over = (element: Element, clientX: number, dataTransfer: object) => {
      const event = createEvent.dragOver(element, { dataTransfer });
      Object.defineProperty(event, 'clientX', { value: clientX });
      fireEvent(element, event);
    };
    const own = transfer();
    fireEvent.dragStart(first!, { dataTransfer: own });
    over(third!, 270, foreign);
    expect(third!.className).not.toContain('drop-');
    over(third!, 270, own);
    expect(third!.className).toContain('drop-after');
    fireEvent.drop(third!, { dataTransfer: own });
    expect(onMove).toHaveBeenCalledWith('a', 2);
  });
});
