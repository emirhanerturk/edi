// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitSummary } from '../../src/git/types';
import { HistoryPanelView, type HistoryPanelViewProps } from '../../src/renderer/history/HistoryPanel';
import type { HistoryRow, RepoGroup } from '../../src/renderer/history/model';

afterEach(cleanup);

const H = 3_600_000;
const D = 24 * H;
const now = new Date(2026, 10, 24, 15, 0).getTime();
const commit = (subject: string, ago: number, short: string, over: Partial<CommitSummary> = {}): CommitSummary => ({
  oid: short.padEnd(40, '0'),
  short,
  subject,
  authorName: 'Me',
  authorEmail: 'me@x.dev',
  date: now - ago,
  parents: 1,
  tags: [],
  ...over,
});
const row = (c: CommitSummary, repoName: string, over: Partial<Extract<HistoryRow, { type: 'commit' }>> = {}): HistoryRow => ({
  type: 'commit',
  repoName,
  repoPath: `/w/${repoName}`,
  commit: c,
  unpushed: false,
  author: null,
  merge: false,
  tag: null,
  ...over,
});

const fix = commit('fix(auth): refresh the session', 25 * 60_000, 'c41e9a2');
const banner = commit('feat(music-quiz): move the banner', H, '3ed0fc5');
const release = commit('1.86.0', H + 60_000, '458d361', { tags: ['v1.86.0'] });
const bump = commit('build(deps): bump fastify', 4 * H, 'e09a4c7');
const merge = commit('Merge pull request #187', 21 * H, '178a970', { parents: 2 });

const rows: HistoryRow[] = [
  { type: 'day', label: 'TODAY', first: true },
  row(fix, 'quizei-app', { unpushed: true }),
  row(banner, 'quizei-app-next-quiz', { tag: 'beta' }),
  { type: 'release', repoName: 'quizei-app-next-quiz', repoPath: '/w/quizei-app-next-quiz', commit: release, tag: 'v1.86.0' },
  row(bump, 'quizei-backend', { author: 'dependabot' }),
  { type: 'day', label: 'YESTERDAY', first: false },
  row(merge, 'quizei-app-next-quiz', { merge: true }),
];

const groups: RepoGroup[] = [
  { repoName: 'quizei-app', repoPath: '/w/quizei-app', ahead: 1, open: true, latest: fix.date, commits: [fix] },
  { repoName: 'quizei-app-next-quiz', repoPath: '/w/quizei-app-next-quiz', ahead: 0, open: true, latest: banner.date, commits: [banner, release] },
  { repoName: 'quizei-frontend', repoPath: '/w/quizei-frontend', ahead: 0, open: false, latest: now - 5 * D, commits: [commit('feat: old', 5 * D, 'aaaaaaa')] },
  { repoName: 'bos', repoPath: '/w/bos', ahead: 0, open: false, latest: null, commits: [] },
];

function renderView(over: Partial<HistoryPanelViewProps> = {}) {
  const props: HistoryPanelViewProps = {
    layout: 'timeline',
    rows,
    groups,
    now,
    single: false,
    branch: null,
    repos: [
      { name: 'quizei-app', path: '/w/quizei-app' },
      { name: 'quizei-backend', path: '/w/quizei-backend' },
    ],
    filter: null,
    loading: false,
    errors: [],
    canLoadMore: false,
    selected: null,
    onOpenCommit: vi.fn(),
    onFilter: vi.fn(),
    onLayout: vi.fn(),
    onLoadMore: vi.fn(),
    ...over,
  };
  render(<HistoryPanelView {...props} />);
  return props;
}

const commitRows = () => screen.getAllByTestId('history-commit');

describe('HistoryPanelView: Timeline', () => {
  it('gün başlıkları ve commit satırları: sönük ön ek, repo, kısa süre, hash', () => {
    renderView();
    expect(screen.getByText('TODAY')).toBeTruthy();
    expect(screen.getByText('YESTERDAY')).toBeTruthy();
    const first = commitRows()[0]!;
    expect(within(first).getByText('fix(auth):', { exact: false }).className).toContain('prefix');
    expect(within(first).getByText('refresh the session')).toBeTruthy();
    expect(within(first).getByText('quizei-app')).toBeTruthy();
    expect(within(first).getByText('25m')).toBeTruthy();
    expect(within(first).getByText('c41e9a2')).toBeTruthy();
    expect(within(first).getByRole('img', { name: 'Not pushed yet' })).toBeTruthy();
    expect(within(commitRows()[1]!).queryByRole('img', { name: 'Not pushed yet' })).toBeNull();
  });

  it('başka yazar, etiket rozeti ve sönük merge', () => {
    renderView();
    expect(within(commitRows()[1]!).getByText('beta')).toBeTruthy();
    expect(within(commitRows()[2]!).getByText('dependabot')).toBeTruthy();
    expect(commitRows()[3]!.getAttribute('data-merge')).toBe('true');
    expect(commitRows()[0]!.getAttribute('data-merge')).toBe('false');
  });

  it('sürüm satırı ince bir etiket çizgisidir', () => {
    renderView();
    const line = screen.getByTestId('history-release');
    expect(within(line).getByText('v1.86.0')).toBeTruthy();
    expect(within(line).getByText('458d361')).toBeTruthy();
  });

  it('tık önizleme, çift tık kalıcı sekmede açar; sürüm satırı da açılır', () => {
    const { onOpenCommit } = renderView();
    fireEvent.click(commitRows()[1]!);
    fireEvent.doubleClick(commitRows()[1]!);
    fireEvent.keyDown(commitRows()[0]!, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('history-release'));
    expect(onOpenCommit).toHaveBeenNthCalledWith(1, '/w/quizei-app-next-quiz', banner.oid, false);
    expect(onOpenCommit).toHaveBeenNthCalledWith(2, '/w/quizei-app-next-quiz', banner.oid, true);
    expect(onOpenCommit).toHaveBeenNthCalledWith(3, '/w/quizei-app', fix.oid, false);
    expect(onOpenCommit).toHaveBeenNthCalledWith(4, '/w/quizei-app-next-quiz', release.oid, false);
  });

  it('orta panelde açık commit seçili görünür', () => {
    renderView({ selected: { repoPath: '/w/quizei-app', oid: fix.oid } });
    expect(commitRows().map((el) => el.getAttribute('aria-current'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('tek repoda repo adı yok; upstream çizgisi ve branch etiketi var', () => {
    renderView({
      single: true,
      branch: 'main',
      rows: [{ type: 'day', label: 'TODAY', first: true }, row(fix, 'quizei-app', { unpushed: true }), { type: 'remote', upstream: 'origin/main' }, row(banner, 'quizei-app')],
    });
    expect(within(commitRows()[0]!).queryByText('quizei-app')).toBeNull();
    expect(screen.getByTestId('history-remote').textContent).toBe('origin/main');
    expect(screen.getByTestId('history-branch').textContent).toBe('main');
  });

  it('"Load 50 more" yalnız daha fazlası varken', () => {
    const { onLoadMore } = renderView({ canLoadMore: true });
    fireEvent.click(screen.getByRole('button', { name: 'Load 50 more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    cleanup();
    renderView({ canLoadMore: false });
    expect(screen.queryByRole('button', { name: 'Load 50 more' })).toBeNull();
  });

  it('yüklenirken, boşken ve okunamayan repoda not', () => {
    renderView({ rows: [], loading: true });
    expect(screen.getByText('Loading…')).toBeTruthy();
    cleanup();
    renderView({ rows: [], loading: false });
    expect(screen.getByText('No commits yet')).toBeTruthy();
    cleanup();
    renderView({ errors: [{ repoName: 'quizei-admin', error: 'fatal: bad object HEAD' }] });
    expect(screen.getByRole('alert').textContent).toContain('quizei-admin');
    expect(screen.getByRole('alert').textContent).toContain('fatal: bad object HEAD');
  });
});

describe('HistoryPanelView: araç çubuğu', () => {
  it('düzen düğmeleri seçili olanı gösterir ve değişikliği bildirir', () => {
    const { onLayout } = renderView();
    const group = screen.getByRole('group', { name: 'History layout' });
    const [timeline, repo] = within(group).getAllByRole('button');
    expect([timeline!.getAttribute('aria-pressed'), repo!.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
    fireEvent.click(repo!);
    expect(onLayout).toHaveBeenCalledWith('byRepo');
  });

  it('repo süzgeci menüsü: tüm repolar ya da biri', () => {
    const { onFilter } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'All repositories' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitemradio').map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['All repositories', 'true'],
      ['quizei-app', 'false'],
      ['quizei-backend', 'false'],
    ]);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'quizei-backend' }));
    expect(onFilter).toHaveBeenCalledWith('/w/quizei-backend');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('süzgeç seçiliyse düğmede repo adı yazar', () => {
    renderView({ filter: '/w/quizei-backend' });
    expect(screen.getByRole('button', { name: 'quizei-backend' })).toBeTruthy();
  });
});

describe('HistoryPanelView: By repo', () => {
  it('açık gruplarda son commitler, kapalılarda son commit zamanı; ↑ sayısı', () => {
    renderView({ layout: 'byRepo' });
    const heads = screen.getAllByTestId('history-group');
    expect(heads.map((el) => el.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'false', 'false']);
    expect(within(heads[0]!).getByText('↑1')).toBeTruthy();
    expect(within(heads[2]!).getByText('5 days ago')).toBeTruthy();
    expect(within(heads[3]!).getByText('No commits')).toBeTruthy();
    const lines = screen.getAllByTestId('history-line');
    expect(lines).toHaveLength(3);
    expect(within(lines[1]!).getByText('1h')).toBeTruthy();
    expect(within(lines[2]!).getByText('v1.86.0')).toBeTruthy();
  });

  it('grup başlığı açar ve kapatır; satır commiti açar', () => {
    const { onOpenCommit } = renderView({ layout: 'byRepo' });
    const heads = screen.getAllByTestId('history-group');
    fireEvent.click(heads[2]!);
    expect(screen.getAllByTestId('history-group')[2]!.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('history-line')).toHaveLength(4);
    fireEvent.click(heads[0]!);
    expect(screen.getAllByTestId('history-line')).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId('history-line')[0]!);
    expect(onOpenCommit).toHaveBeenCalledWith('/w/quizei-app-next-quiz', banner.oid, false);
  });
});
