// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDiff } from '../../src/git/diffParse';
import type { FileChange } from '../../src/git/types';
import { DiffPane } from '../../src/renderer/center/DiffPane';
import type { DiffView } from '../../src/shared/api';

afterEach(cleanup);

const file: FileChange = { path: 'app/game/play.tsx', origPath: null, x: '.', y: 'M', kind: 'changed' };
const diff = parseDiff(
  ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1,3 +1,4 @@ function a() {', ' bir', '-iki', '+İKİ', '+iki buçuk', ' üç', ''].join('\n'),
);
const loaded: DiffView = { ok: true, diff, file };

function renderPane(view: DiffView | null, mode: 'split' | 'inline' = 'split') {
  const handlers = { onMode: vi.fn(), onOpenIn: vi.fn(), onOpenFile: vi.fn() };
  render(<DiffPane repoName="quizei-app" path="app/game/play.tsx" view={view} mode={mode} tokens={null} {...handlers} />);
  return handlers;
}
const cell = (row: HTMLElement, side: 'old' | 'new') => row.querySelector<HTMLElement>(`[data-side="${side}"]`)!;

describe('DiffPane', () => {
  it('the header shows repo, path and totals', () => {
    renderPane(loaded);
    const header = screen.getByTestId('view-header');
    expect(within(header).getByText('quizei-app')).toBeTruthy();
    expect(header.textContent).toContain('app/game/play.tsx');
    expect(within(header).getByText('+2')).toBeTruthy();
    expect(within(header).getByText('−1')).toBeTruthy();
  });

  it('"Open file" opens the whole file; no button for a deleted file or before loading', () => {
    const { onOpenFile } = renderPane(loaded);
    fireEvent.click(within(screen.getByTestId('view-header')).getByRole('button', { name: 'Open file' }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    for (const gone of [
      { ...file, x: '.', y: 'D' },
      { ...file, x: 'D', y: '.' },
    ]) {
      cleanup();
      renderPane({ ok: true, diff, file: gone });
      expect(screen.queryByRole('button', { name: 'Open file' }), `${gone.x}${gone.y}`).toBeNull();
    }
    cleanup();
    renderPane(null);
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull();
    // A staged file that is still in the working tree can be opened.
    cleanup();
    renderPane({ ok: true, diff, file: { ...file, x: 'A', y: '.' } });
    expect(screen.getByRole('button', { name: 'Open file' })).toBeTruthy();
  });

  it('split: numbers, signs and the empty side', () => {
    renderPane(loaded);
    expect(screen.getByText('@@ -1,3 +1,4 @@ function a() {')).toBeTruthy();
    const rows = screen.getAllByTestId('diff-row');
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => `${cell(row, 'old').dataset.kind}|${cell(row, 'new').dataset.kind}`)).toEqual([
      'context|context',
      'del|add',
      'empty|add',
      'context|context',
    ]);
    expect(cell(rows[1]!, 'old').textContent).toBe('2−iki');
    expect(cell(rows[1]!, 'new').textContent).toBe('2+İKİ');
    expect(cell(rows[2]!, 'old').textContent).toBe('');
    expect(cell(rows[3]!, 'new').textContent).toBe('4üç');
    expect(screen.getByText('HEAD')).toBeTruthy();
    expect(screen.getByText('WORKING TREE')).toBeTruthy();
  });

  it('inline: two number columns, lines in diff order', () => {
    renderPane(loaded, 'inline');
    const rows = screen.getAllByTestId('diff-row');
    expect(rows.map((row) => row.dataset.kind)).toEqual(['context', 'del', 'add', 'add', 'context']);
    expect(rows.map((row) => row.textContent)).toEqual(['11bir', '2−iki', '2+İKİ', '3+iki buçuk', '34üç']);
    expect(screen.queryByText('WORKING TREE')).toBeNull();
  });

  it('reports the Split / Inline choice; the selected one shows as pressed', () => {
    const { onMode } = renderPane(loaded);
    const group = screen.getByRole('group', { name: 'Diff view' });
    expect(within(group).getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Inline' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(group).getByRole('button', { name: 'Inline' }));
    expect(onMode).toHaveBeenCalledWith('inline');
  });

  it('Open in… opens the file in the editor picked', () => {
    const { onOpenIn } = renderPane(loaded);
    fireEvent.click(screen.getByRole('button', { name: 'Open in…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Antigravity' }));
    expect(onOpenIn).toHaveBeenCalledWith('antigravity');
  });

  it('once colors arrive, the line text is made of colored spans', () => {
    const tokens = { old: new Map(), new: new Map([[2, [{ text: 'İK', color: '#c678dd' }, { text: 'İ', color: '#98c379' }]]]) };
    render(<DiffPane repoName="r" path="a.ts" view={loaded} mode="split" tokens={tokens} onMode={() => undefined} onOpenIn={() => undefined} onOpenFile={() => undefined} />);
    const code = cell(screen.getAllByTestId('diff-row')[1]!, 'new').querySelector('.code')!;
    expect([...code.querySelectorAll('span')].map((span) => [span.textContent, span.style.color])).toEqual([
      ['İK', 'rgb(198, 120, 221)'],
      ['İ', 'rgb(152, 195, 121)'],
    ]);
  });

  it('shows a note instead of the diff for a binary file', () => {
    renderPane({ ok: true, diff: { hunks: [], added: 0, removed: 0, binary: true }, file });
    expect(screen.getByText('Binary file — no diff to show')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Diff view' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in…' })).toBeTruthy();
  });

  it('says so when the file has no changes left', () => {
    renderPane({ ok: false, error: 'File is not in the list of changes' });
    expect(screen.getByText('No changes left in this file')).toBeTruthy();
  });

  it('says there are no content changes when only the name or mode changed', () => {
    renderPane({ ok: true, diff: { hunks: [], added: 0, removed: 0, binary: false }, file: { ...file, origPath: 'app/old.tsx', x: 'R', y: '.' } });
    expect(screen.getByText('No content changes')).toBeTruthy();
    expect(screen.getByText(/Renamed from app\/old\.tsx/)).toBeTruthy();
  });

  it('a calm note, not an alert, for a very large diff', () => {
    renderPane({ ok: false, error: 'This diff is too large to show' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('This diff is too large to show — open the file in Zed')).toBeTruthy();
  });

  it('shows other errors as they are', () => {
    renderPane({ ok: false, error: 'fatal: bad revision' });
    expect(screen.getByRole('alert').textContent).toContain('fatal: bad revision');
  });

  it('keeps the header and shows no lines while loading', () => {
    renderPane(null);
    expect(screen.getByTestId('view-header')).toBeTruthy();
    expect(screen.queryAllByTestId('diff-row')).toHaveLength(0);
  });
});
