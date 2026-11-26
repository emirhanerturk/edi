// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoView, TextLine } from '../../src/shared/api';

vi.mock('../../src/renderer/bridge', () => ({
  edi: { on: () => () => undefined, setUnsaved: vi.fn(), setLayout: vi.fn(), stopSearch: vi.fn(), searchText: vi.fn(() => new Promise(() => undefined)) },
}));

const { useApp } = await import('../../src/renderer/store');
const { useSearch } = await import('../../src/renderer/search/searchStore');
const { SearchPanel, lineSegments } = await import('../../src/renderer/search/SearchPanel');

afterEach(cleanup);

const repo = (name: string, files: RepoView['status'] extends infer S ? (S extends { files: infer F } ? F : never) : never = []): RepoView => ({
  name,
  path: `/w/${name}`,
  status: { head: name === 'admin' ? 'feat/user-table' : 'main', headOid: 'a'.repeat(40), detached: false, unborn: false, upstream: null, ahead: null, behind: null, stashes: 0, files },
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
});
const line = (number: number, text: string, start: number, end: number): TextLine => ({ line: number, text, from: 0, cut: false, ranges: [[start, end]], count: 1 });
const query = { pattern: 'weeklyRank', regex: false, matchCase: false, wholeWord: false, include: '' };

beforeEach(() => {
  useApp.setState({
    workspace: { dir: '/w', repos: [repo('app', [{ path: 'src/rank.ts', origPath: null, x: '.', y: 'M', kind: 'changed' }]), repo('admin')], ignored: 0, rootSessions: 0, refreshedAt: 1 },
    reveal: null,
    center: { tabs: [], active: null, open: false },
  });
  useSearch.setState({
    form: { pattern: 'weeklyRank', replacement: '', showReplace: false, matchCase: false, wholeWord: false, regex: false, include: '', repo: null },
    ran: query,
    order: ['/w/app', '/w/admin'],
    results: {
      '/w/app': { state: 'done', files: [{ path: 'src/rank.ts', stamp: 'a'.repeat(40), lines: [line(3, '  const weeklyRank = 1;', 8, 18), line(9, 'return weeklyRank;', 7, 17)] }], count: 2, truncated: false },
      '/w/admin': { state: 'done', files: [{ path: 'lib/models.ts', stamp: 'b'.repeat(40), lines: [line(5, 'weeklyRank: number;', 0, 10)] }], count: 1, truncated: false },
    },
    dismissed: {},
    collapsed: {},
    done: null,
    notice: null,
    busy: false,
  });
});

describe('lineSegments', () => {
  const options = { pattern: '(\\w+)Rank', regex: true, matchCase: false, wholeWord: false };
  it('starts at the first non-blank, or near a match far into the line', () => {
    expect(lineSegments(line(1, '    a weeklyRank', 6, 16), null, options).map((s) => [s.kind, s.text])).toEqual([
      ['plain', 'a '],
      ['match', 'weeklyRank'],
    ]);
    const far = lineSegments(line(1, `${'x'.repeat(60)}weeklyRank`, 60, 70), null, options);
    expect(far[0]).toEqual({ text: '…', kind: 'more' });
  });

  it('shows each match struck through with what replaces it', () => {
    expect(lineSegments(line(1, 'a weeklyRank b', 2, 12), '$1Place', options).map((s) => [s.kind, s.text])).toEqual([
      ['plain', 'a '],
      ['old', 'weeklyRank'],
      ['new', 'weeklyPlace'],
      ['plain', ' b'],
    ]);
    expect(lineSegments(line(1, 'weeklyRank', 0, 10), '$1', { ...options, regex: false }).map((s) => s.text)).toEqual(['weeklyRank', '$1']);
  });
});

describe('SearchPanel', () => {
  it('lists the results by repository and file, with the counts', () => {
    render(<SearchPanel />);
    expect(screen.getByTestId('search-summary').textContent).toBe('3 results in 2 files · 2 repositories');
    expect(screen.getAllByTestId('search-repo').map((group) => group.querySelector('.search-repo-name')!.textContent)).toEqual(['app', 'admin']);
    expect(screen.getAllByTestId('search-file').map((row) => row.getAttribute('data-path'))).toEqual(['src/rank.ts', 'lib/models.ts']);
    const first = screen.getAllByTestId('search-line')[0]!;
    expect(first.querySelector('.seg-match')!.textContent).toBe('weeklyRank');
    expect(first.querySelector('.search-line-number')!.textContent).toBe('3');
  });

  it('opens a result in the file at its line', () => {
    render(<SearchPanel />);
    fireEvent.click(screen.getAllByTestId('search-line')[1]!.querySelector('button')!);
    expect(useApp.getState().center.tabs.map((tab) => [tab.kind, tab.path])).toEqual([['file', 'src/rank.ts']]);
    expect(useApp.getState().reveal).toEqual(expect.objectContaining({ repoPath: '/w/app', path: 'src/rank.ts', line: 9, column: 8, length: 10 }));
    expect(screen.getAllByTestId('search-line')[1]!.className).toContain('active');
  });

  it('dismisses a file, and folds a repository', () => {
    render(<SearchPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss this file' })[1]!);
    expect(screen.getByTestId('search-summary').textContent).toBe('2 results in 1 file · 1 repository');
    fireEvent.click(screen.getByText('app').closest('button')!);
    expect(screen.queryAllByTestId('search-file')).toHaveLength(0);
  });

  it('previews the replacement, and says why a pattern is refused', () => {
    act(() => useSearch.setState((s) => ({ form: { ...s.form, showReplace: true, replacement: 'weekRank' } })));
    render(<SearchPanel />);
    const first = screen.getAllByTestId('search-line')[0]!;
    expect([first.querySelector('.seg-old')!.textContent, first.querySelector('.seg-new')!.textContent]).toEqual(['weeklyRank', 'weekRank']);
    expect(screen.getByRole('button', { name: 'Replace all' })).toHaveProperty('disabled', false);
    act(() => useSearch.setState((s) => ({ form: { ...s.form, pattern: 'fetch(', regex: true } })));
    expect(screen.getByTestId('search-error').textContent).toBe('Not a valid regular expression: unterminated group');
  });

  it('shows what Replace All did', () => {
    act(() => useSearch.setState({ done: { count: 19, files: 7, skipped: ['Skipped app/src/api/models.ts: it changed after the search. Search again to include it.'] } }));
    render(<SearchPanel />);
    expect(screen.getByTestId('search-done').textContent).toContain('19 occurrences replaced in 7 files');
    expect(screen.getByTestId('search-done').textContent).toContain('Skipped app/src/api/models.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Show in the Git tab' }));
    expect(useApp.getState().rightTab).toBe('git');
  });

  it('says when nothing is found', () => {
    act(() => useSearch.setState({ results: { '/w/app': { state: 'done', files: [], count: 0, truncated: false }, '/w/admin': { state: 'done', files: [], count: 0, truncated: false } } }));
    render(<SearchPanel />);
    expect(screen.getByTestId('search-summary').textContent).toBe('No results');
    expect(screen.getByText(/Nothing found in the 2 repositories/)).toBeTruthy();
  });
});
