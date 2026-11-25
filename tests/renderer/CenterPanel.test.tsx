// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenterTabs, type TabLabel } from '../../src/renderer/center/CenterTabs';

afterEach(cleanup);

const labels: TabLabel[] = [
  { id: 'diff:/w/a:app/play.tsx', kind: 'diff', name: 'play.tsx', dir: 'app', letter: 'M', pinned: true },
  { id: 'file:/w/a:lib/new.ts', kind: 'file', name: 'new.ts', dir: 'lib', letter: '?', pinned: false },
  { id: 'file:/w/a:README.md', kind: 'file', name: 'README.md', dir: '', letter: null, pinned: true, unsaved: true },
];

function renderTabs(active = labels[0]!.id) {
  const handlers = { onActivate: vi.fn(), onPin: vi.fn(), onClose: vi.fn(), onClosePanel: vi.fn() };
  render(<CenterTabs tabs={labels} active={active} {...handlers} />);
  return handlers;
}

describe('CenterTabs from the keyboard', () => {
  it('Tab reaches the active tab; Left and Right activate the neighbours; Enter keeps a preview tab', () => {
    const handlers = renderTabs(labels[1]!.id);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    tabs[1]!.focus();
    fireEvent.keyDown(tabs[1]!, { key: 'ArrowRight' });
    expect(handlers.onActivate).toHaveBeenLastCalledWith(labels[2]!.id);
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowRight' }); // wraps around
    expect(handlers.onActivate).toHaveBeenLastCalledWith(labels[0]!.id);
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(handlers.onActivate).toHaveBeenLastCalledWith(labels[2]!.id);
    fireEvent.keyDown(tabs[1]!, { key: 'Enter' });
    expect(handlers.onPin).toHaveBeenCalledWith(labels[1]!.id);
  });
});

describe('CenterTabs', () => {
  it('a tab with unsaved edits shows a dot that is always visible and still closes the tab', () => {
    const { onClose } = renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('data-unsaved'))).toEqual([null, null, 'true']);
    const close = within(tabs[2]!).getByRole('button', { name: 'Close tab (unsaved changes)' });
    expect(close.getAttribute('data-reveal')).toBe('always');
    expect(close.querySelector('.tab-dot')).toBeTruthy();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledWith(labels[2]!.id);
    expect(tabs[2]!.getAttribute('title')).toBe('README.md · unsaved changes');
  });

  it('shows tabs with their letter and name; the active tab shows the folder, a background diff tab says "diff"', () => {
    renderTabs(labels[1]!.id);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(within(tabs[0]!).getByText('M')).toBeTruthy();
    expect(within(tabs[0]!).getByText('play.tsx')).toBeTruthy();
    expect(within(tabs[0]!).getByText('diff')).toBeTruthy();
    expect(within(tabs[1]!).getByText('lib')).toBeTruthy();
    expect(within(tabs[2]!).queryByText('diff')).toBeNull();
  });

  it('marks the preview tab', () => {
    renderTabs();
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-preview'))).toEqual(['false', 'true', 'false']);
  });

  it('a click switches to the tab, a double-click pins it', () => {
    const { onActivate, onPin } = renderTabs();
    const tab = screen.getAllByRole('tab')[1]!;
    fireEvent.mouseDown(tab, { button: 0 });
    expect(onActivate).toHaveBeenCalledWith(labels[1]!.id);
    fireEvent.doubleClick(tab);
    expect(onPin).toHaveBeenCalledWith(labels[1]!.id);
  });

  it('every tab has a close button; on an inactive tab it shows on hover; it closes without switching to the tab', () => {
    const { onClose, onActivate } = renderTabs();
    const buttons = screen.getAllByRole('button', { name: /^Close tab/ });
    expect(buttons).toHaveLength(labels.length);
    // The third tab has unsaved edits: its dot always shows.
    expect(buttons.map((button) => button.dataset.reveal)).toEqual(['always', 'hover', 'always']);
    fireEvent.mouseDown(buttons[0]!, { button: 0 });
    fireEvent.click(buttons[0]!);
    expect(onClose).toHaveBeenCalledWith(labels[0]!.id);
    fireEvent.mouseDown(buttons[2]!, { button: 0 });
    fireEvent.click(buttons[2]!);
    expect(onClose).toHaveBeenLastCalledWith(labels[2]!.id);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('the middle mouse button closes the tab', () => {
    const { onClose } = renderTabs();
    fireEvent.mouseDown(screen.getAllByRole('tab')[2]!, { button: 1 });
    expect(onClose).toHaveBeenCalledWith(labels[2]!.id);
  });

  it('a commit tab shows a commit icon and the short hash', () => {
    const commit: TabLabel = { id: 'commit:/w/a:3ed0fc5aaaa', kind: 'commit', name: '3ed0fc5', dir: 'quizei-app', letter: null, pinned: true };
    render(<CenterTabs tabs={[...labels, commit]} active={labels[0]!.id} onActivate={vi.fn()} onPin={vi.fn()} onClose={vi.fn()} onClosePanel={vi.fn()} />);
    const tab = screen.getAllByRole('tab')[3]!;
    expect(within(tab).getByText('3ed0fc5')).toBeTruthy();
    expect(within(tab).getByTestId('commit-icon')).toBeTruthy();
    expect(within(tab).queryByText('diff')).toBeNull();
  });

  it('the button at the right end closes the panel', () => {
    const { onClosePanel } = renderTabs();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onClosePanel).toHaveBeenCalledTimes(1);
  });

  it('the + button and a double click on the empty part of the bar open a new file; a tab double click does not', () => {
    const onNew = vi.fn();
    const onPin = vi.fn();
    render(<CenterTabs tabs={labels} active={labels[0]!.id} onActivate={vi.fn()} onPin={onPin} onClose={vi.fn()} onClosePanel={vi.fn()} onNew={onNew} />);
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    expect(onNew).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(screen.getByRole('tablist'));
    expect(onNew).toHaveBeenCalledTimes(2);
    fireEvent.doubleClick(screen.getAllByTestId('center-tab')[0]!);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Close panel' }));
    expect(onNew).toHaveBeenCalledTimes(2);
    expect(onPin).toHaveBeenCalledTimes(1);
  });
});
