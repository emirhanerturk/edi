// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RightPanelView } from '../../src/renderer/right/RightPanel';

afterEach(cleanup);

function renderPanel(tab: 'git' | 'files', badge = 3) {
  const handlers = { onTab: vi.fn(), onFetchAll: vi.fn(), onRescan: vi.fn(), onCollapseAll: vi.fn() };
  render(
    <RightPanelView tab={tab} badge={badge} canFetch {...handlers}>
      <p>içerik</p>
    </RightPanelView>,
  );
  return handlers;
}

describe('RightPanelView', () => {
  it('Git ve Files sekmeleri; seçili olan işaretli', () => {
    renderPanel('git');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['Git3', 'true'],
      ['Files', 'false'],
    ]);
    expect(screen.getByText('içerik')).toBeTruthy();
  });

  it('rozet değişen dosya sayısıdır; değişiklik yoksa görünmez', () => {
    renderPanel('git', 3);
    expect(screen.getByTestId('git-badge').textContent).toBe('3');
    cleanup();
    renderPanel('git', 0);
    expect(screen.queryByTestId('git-badge')).toBeNull();
  });

  it('sekmeye tıklamak sekmeyi değiştirir', () => {
    const { onTab } = renderPanel('git');
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }));
    expect(onTab).toHaveBeenCalledWith('files');
  });

  it('Git sekmesinde fetch ve yeniden tarama düğmeleri', () => {
    const { onFetchAll, onRescan } = renderPanel('git');
    fireEvent.click(screen.getByRole('button', { name: 'Fetch all repositories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rescan repositories' }));
    expect(onFetchAll).toHaveBeenCalledTimes(1);
    expect(onRescan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull();
  });

  it('Files sekmesinde "Collapse all" düğmesi', () => {
    const { onCollapseAll } = renderPanel('files');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Fetch all repositories' })).toBeNull();
  });
});
