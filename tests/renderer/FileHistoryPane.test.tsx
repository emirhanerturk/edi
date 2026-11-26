// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitSummary, FileHistoryEntry } from '../../src/shared/api';
import { FileHistoryPane, type FileHistoryPaneProps, UNCOMMITTED } from '../../src/renderer/center/FileHistoryPane';

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const commit = (n: number, subject: string): CommitSummary => ({
  oid: String(n).repeat(40).slice(0, 40),
  short: String(n).repeat(7),
  subject,
  authorName: 'Ada Lin',
  authorEmail: 'ada@example.com',
  date: NOW - n * 3_600_000,
  parents: 1,
  tags: [],
});
const entry = (n: number, subject: string, over: Partial<FileHistoryEntry> = {}): FileHistoryEntry => ({
  commit: commit(n, subject),
  path: 'src/screens/RankingScreen.tsx',
  origPath: null,
  added: 5,
  removed: 1,
  binary: false,
  ...over,
});
const entries = [entry(1, 'feat(ranking): show the badge'), entry(2, 'refactor: move the screens', { origPath: 'src/Ranking.tsx', added: 0, removed: 0 }), entry(3, 'feat: first', { path: 'src/Ranking.tsx' })];
const diff = { hunks: [{ header: '@@ -1 +1 @@', lines: [{ kind: 'del' as const, oldNo: 1, text: 'a' }, { kind: 'add' as const, newNo: 1, text: 'b' }] }], added: 1, removed: 1, binary: false };

function renderPane(over: Partial<FileHistoryPaneProps> = {}) {
  const props: FileHistoryPaneProps = {
    repoName: 'quizei-app',
    path: 'src/screens/RankingScreen.tsx',
    history: { ok: true, entries, hasMore: false },
    uncommitted: false,
    selected: entries[0]!.commit.oid,
    onSelect: vi.fn(),
    change: { ok: true, diff },
    tokens: null,
    now: NOW,
    copied: null,
    canLoadMore: false,
    onLoadMore: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenIn: vi.fn(),
    onOpenCommit: vi.fn(),
    onOpenChanges: vi.fn(),
    onCopy: vi.fn(),
    ...over,
  };
  render(<FileHistoryPane {...props} />);
  return props;
}

describe('FileHistoryPane', () => {
  it('lists the commits with their counts, marks the rename, and shows the selected change', () => {
    const props = renderPane();
    const rows = screen.getAllByTestId('file-history-row');
    expect(rows.map((row) => row.querySelector('.file-history-subject')!.textContent)).toEqual(['feat(ranking): show the badge', 'refactor: move the screens', 'feat: first']);
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    expect(rows[0]!.textContent).toContain('+5 −1');
    expect(screen.getByTestId('file-history-rename').textContent).toBe('renamed from src/Ranking.tsx');
    expect(screen.getByTestId('file-history-count').textContent).toBe('3 commits');
    expect(screen.getByTestId('file-history-detail').textContent).toContain('Ada Lin');
    expect(screen.getAllByTestId('diff-row')).toHaveLength(2);

    fireEvent.click(rows[2]!);
    expect(props.onSelect).toHaveBeenCalledWith(entries[2]!.commit.oid);
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(props.onSelect).toHaveBeenLastCalledWith(entries[1]!.commit.oid);
    fireEvent.click(screen.getByRole('button', { name: /Open commit/ }));
    expect(props.onOpenCommit).toHaveBeenCalledWith(entries[0]!.commit.oid);
  });

  it('puts the uncommitted changes first; their detail opens the diff', () => {
    const props = renderPane({ uncommitted: true, selected: UNCOMMITTED });
    const rows = screen.getAllByTestId('file-history-row');
    expect(rows[0]!.textContent).toContain('Uncommitted changes');
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Open changes' }));
    expect(props.onOpenChanges).toHaveBeenCalled();
  });

  it('a file without commits says so; a renamed commit without content changes says that', () => {
    renderPane({ history: { ok: true, entries: [], hasMore: false } });
    expect(screen.getByText('No commit has this file yet')).toBeTruthy();
    cleanup();
    renderPane({ selected: entries[1]!.commit.oid, change: { ok: true, diff: { hunks: [], added: 0, removed: 0, binary: false } } });
    expect(screen.getByText('Renamed from src/Ranking.tsx, no content changes')).toBeTruthy();
  });

  it('offers 50 more when there are', () => {
    const props = renderPane({ history: { ok: true, entries, hasMore: true }, canLoadMore: true });
    expect(screen.getByTestId('file-history-count').textContent).toBe('3+ commits');
    fireEvent.click(screen.getByRole('button', { name: 'Load 50 more' }));
    expect(props.onLoadMore).toHaveBeenCalled();
  });
});
