// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RightPanelView } from '../../src/renderer/right/RightPanel';

afterEach(cleanup);

function renderPanel(tab: 'git' | 'history' | 'files', badge = 3) {
  const handlers = { onTab: vi.fn(), onFetchAll: vi.fn(), onRescan: vi.fn(), onCollapseAll: vi.fn(), onRefreshHistory: vi.fn() };
  render(
    <RightPanelView tab={tab} badge={badge} canFetch {...handlers}>
      <p>content</p>
    </RightPanelView>,
  );
  return handlers;
}

describe('RightPanelView', () => {
  it('Git, History and Files tabs; the selected one is marked', () => {
    renderPanel('git');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['Git3', 'true'],
      ['History', 'false'],
      ['Files', 'false'],
    ]);
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('the badge is the changed file count; hidden when there are no changes', () => {
    renderPanel('git', 3);
    expect(screen.getByTestId('git-badge').textContent).toBe('3');
    cleanup();
    renderPanel('git', 0);
    expect(screen.queryByTestId('git-badge')).toBeNull();
  });

  it('clicking a tab switches tabs', () => {
    const { onTab } = renderPanel('git');
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }));
    expect(onTab).toHaveBeenCalledWith('files');
  });

  it('fetch and rescan buttons on the Git tab', () => {
    const { onFetchAll, onRescan } = renderPanel('git');
    fireEvent.click(screen.getByRole('button', { name: 'Fetch all repositories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rescan repositories' }));
    expect(onFetchAll).toHaveBeenCalledTimes(1);
    expect(onRescan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull();
  });

  it('a refresh button on the History tab', () => {
    const { onRefreshHistory, onTab } = renderPanel('history');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
    expect(onRefreshHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fetch all repositories' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Git/ }));
    expect(onTab).toHaveBeenCalledWith('git');
  });

  it('a "Collapse all" button on the Files tab', () => {
    const { onCollapseAll } = renderPanel('files');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Fetch all repositories' })).toBeNull();
    // Without a single repo to put them in, no New File / New Folder buttons.
    expect(screen.queryByRole('button', { name: 'New File' })).toBeNull();
  });

  it('New File and New Folder on the Files tab when the open folder is one repo', () => {
    const onNewEntry = vi.fn();
    render(
      <RightPanelView tab="files" badge={0} canFetch={false} onTab={vi.fn()} onFetchAll={vi.fn()} onRescan={vi.fn()} onCollapseAll={vi.fn()} onRefreshHistory={vi.fn()} onNewEntry={onNewEntry}>
        <p>content</p>
      </RightPanelView>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New File' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
    expect(onNewEntry.mock.calls).toEqual([['file'], ['dir']]);
  });
});
