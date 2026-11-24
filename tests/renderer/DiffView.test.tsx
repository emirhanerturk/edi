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
  const handlers = { onMode: vi.fn(), onOpenInZed: vi.fn() };
  render(<DiffPane repoName="quizei-app" path="app/game/play.tsx" view={view} mode={mode} tokens={null} {...handlers} />);
  return handlers;
}
const cell = (row: HTMLElement, side: 'old' | 'new') => row.querySelector<HTMLElement>(`[data-side="${side}"]`)!;

describe('DiffPane', () => {
  it('başlıkta repo, yol ve toplamlar görünür', () => {
    renderPane(loaded);
    const header = screen.getByTestId('view-header');
    expect(within(header).getByText('quizei-app')).toBeTruthy();
    expect(header.textContent).toContain('app/game/play.tsx');
    expect(within(header).getByText('+2')).toBeTruthy();
    expect(within(header).getByText('−1')).toBeTruthy();
  });

  it('yan yana: numaralar, işaretler ve boş taraf', () => {
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

  it('tek sütun: iki numara sütunu, satırlar diff sırasında', () => {
    renderPane(loaded, 'inline');
    const rows = screen.getAllByTestId('diff-row');
    expect(rows.map((row) => row.dataset.kind)).toEqual(['context', 'del', 'add', 'add', 'context']);
    expect(rows.map((row) => row.textContent)).toEqual(['11bir', '2−iki', '2+İKİ', '3+iki buçuk', '34üç']);
    expect(screen.queryByText('WORKING TREE')).toBeNull();
  });

  it('Split / Inline seçimi bildirilir; seçili olan basılı görünür', () => {
    const { onMode } = renderPane(loaded);
    const group = screen.getByRole('group', { name: 'Diff view' });
    expect(within(group).getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Inline' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(group).getByRole('button', { name: 'Inline' }));
    expect(onMode).toHaveBeenCalledWith('inline');
  });

  it("Open in Zed düğmesi çalışır", () => {
    const { onOpenInZed } = renderPane(loaded);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Zed' }));
    expect(onOpenInZed).toHaveBeenCalledTimes(1);
  });

  it('renkler geldiyse satır metni renkli parçalardan oluşur', () => {
    const tokens = { old: new Map(), new: new Map([[2, [{ text: 'İK', color: '#c678dd' }, { text: 'İ', color: '#98c379' }]]]) };
    render(<DiffPane repoName="r" path="a.ts" view={loaded} mode="split" tokens={tokens} onMode={() => undefined} onOpenInZed={() => undefined} />);
    const code = cell(screen.getAllByTestId('diff-row')[1]!, 'new').querySelector('.code')!;
    expect([...code.querySelectorAll('span')].map((span) => [span.textContent, span.style.color])).toEqual([
      ['İK', 'rgb(198, 120, 221)'],
      ['İ', 'rgb(152, 195, 121)'],
    ]);
  });

  it('ikili dosyada diff yerine not gösterir', () => {
    renderPane({ ok: true, diff: { hunks: [], added: 0, removed: 0, binary: true }, file });
    expect(screen.getByText('Binary file — no diff to show')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Diff view' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in Zed' })).toBeTruthy();
  });

  it('dosyada değişiklik kalmadıysa bunu söyler', () => {
    renderPane({ ok: false, error: 'File is not in the list of changes' });
    expect(screen.getByText('No changes left in this file')).toBeTruthy();
  });

  it('yalnız adı ya da izni değişen dosyada içerik farkı olmadığını söyler', () => {
    renderPane({ ok: true, diff: { hunks: [], added: 0, removed: 0, binary: false }, file: { ...file, origPath: 'app/old.tsx', x: 'R', y: '.' } });
    expect(screen.getByText('No content changes')).toBeTruthy();
    expect(screen.getByText(/Renamed from app\/old\.tsx/)).toBeTruthy();
  });

  it('çok büyük diff için uyarı değil, sakin bir not', () => {
    renderPane({ ok: false, error: 'This diff is too large to show' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('This diff is too large to show — open the file in Zed')).toBeTruthy();
  });

  it('başka hatayı olduğu gibi gösterir', () => {
    renderPane({ ok: false, error: 'fatal: bad revision' });
    expect(screen.getByRole('alert').textContent).toContain('fatal: bad revision');
  });

  it('yüklenirken başlık durur, satır yoktur', () => {
    renderPane(null);
    expect(screen.getByTestId('view-header')).toBeTruthy();
    expect(screen.queryAllByTestId('diff-row')).toHaveLength(0);
  });
});
