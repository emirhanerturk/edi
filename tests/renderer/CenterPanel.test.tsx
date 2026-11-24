// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenterTabs, type TabLabel } from '../../src/renderer/center/CenterTabs';

afterEach(cleanup);

const labels: TabLabel[] = [
  { id: 'diff:/w/a:app/play.tsx', kind: 'diff', name: 'play.tsx', dir: 'app', letter: 'M', pinned: true },
  { id: 'file:/w/a:lib/new.ts', kind: 'file', name: 'new.ts', dir: 'lib', letter: '?', pinned: false },
  { id: 'file:/w/a:README.md', kind: 'file', name: 'README.md', dir: '', letter: null, pinned: true },
];

function renderTabs(active = labels[0]!.id) {
  const handlers = { onActivate: vi.fn(), onPin: vi.fn(), onClose: vi.fn(), onClosePanel: vi.fn() };
  render(<CenterTabs tabs={labels} active={active} {...handlers} />);
  return handlers;
}

describe('CenterTabs', () => {
  it('sekmeleri harfi ve adıyla gösterir; etkin sekmede klasör, arka plandaki diff sekmesinde "diff" yazar', () => {
    renderTabs(labels[1]!.id);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(within(tabs[0]!).getByText('M')).toBeTruthy();
    expect(within(tabs[0]!).getByText('play.tsx')).toBeTruthy();
    expect(within(tabs[0]!).getByText('diff')).toBeTruthy();
    expect(within(tabs[1]!).getByText('lib')).toBeTruthy();
    expect(within(tabs[2]!).queryByText('diff')).toBeNull();
  });

  it('önizleme sekmesini işaretler', () => {
    renderTabs();
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-preview'))).toEqual(['false', 'true', 'false']);
  });

  it('tıklayınca sekmeye geçer, çift tıklayınca kalıcı yapar', () => {
    const { onActivate, onPin } = renderTabs();
    const tab = screen.getAllByRole('tab')[1]!;
    fireEvent.mouseDown(tab, { button: 0 });
    expect(onActivate).toHaveBeenCalledWith(labels[1]!.id);
    fireEvent.doubleClick(tab);
    expect(onPin).toHaveBeenCalledWith(labels[1]!.id);
  });

  it('kapatma düğmesi yalnız etkin sekmededir ve sekmeye geçmeden kapatır', () => {
    const { onClose, onActivate } = renderTabs();
    const buttons = screen.getAllByRole('button', { name: 'Close tab' });
    expect(buttons).toHaveLength(1);
    fireEvent.mouseDown(buttons[0]!, { button: 0 });
    fireEvent.click(buttons[0]!);
    expect(onClose).toHaveBeenCalledWith(labels[0]!.id);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('orta tuş sekmeyi kapatır', () => {
    const { onClose } = renderTabs();
    fireEvent.mouseDown(screen.getAllByRole('tab')[2]!, { button: 1 });
    expect(onClose).toHaveBeenCalledWith(labels[2]!.id);
  });

  it('sağ uçtaki düğme paneli kapatır', () => {
    const { onClosePanel } = renderTabs();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onClosePanel).toHaveBeenCalledTimes(1);
  });
});
