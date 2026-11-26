// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/bridge', () => ({ edi: { on: () => () => undefined, setUnsaved: vi.fn() } }));
vi.mock('../../src/renderer/terminals/terminals', () => ({ showTerminal: vi.fn() }));

const { useApp, moveTab, dropIndex } = await import('../../src/renderer/store');
const { TabBar, dropSide } = await import('../../src/renderer/terminals/TabBar');
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
    expect(titles(moveTab(tabs, 1, dropIndex(tabs, 1, 2, 'after')))).toBe('bac');
    expect(titles(moveTab(tabs, 3, dropIndex(tabs, 3, 1, 'before')))).toBe('cab');
    expect(titles(moveTab(tabs, 2, dropIndex(tabs, 2, 3, 'after')))).toBe('acb');
  });

  it('leaves the order alone where the tab already is', () => {
    const tabs = [A, B, C];
    expect(dropIndex(tabs, 1, 2, 'before')).toBe(0);
    expect(dropIndex(tabs, 1, 1, 'after')).toBe(0);
    expect(moveTab(tabs, 1, 0)).toBe(tabs);
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
