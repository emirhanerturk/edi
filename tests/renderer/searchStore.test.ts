import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoView, ReplaceAllSummary, ReplaceResult, TextFile, TextQuery, TextSearchResult } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    getState: () => new Promise(() => undefined),
    claudeUsage: () => new Promise(() => undefined),
    setLayout: vi.fn(),
    setUnsaved: vi.fn(),
    searchText: vi.fn<(repoPath: string, query: TextQuery, id: number) => Promise<TextSearchResult>>(),
    stopSearch: vi.fn<(id: number) => void>(),
    replaceText: vi.fn<(repoPath: string, path: string, query: TextQuery, replacement: string, stamp: string, lines: number[]) => Promise<ReplaceResult>>(),
    confirmReplaceAll: vi.fn<(summary: ReplaceAllSummary) => Promise<boolean>>(),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp } = await import('../../src/renderer/store');
const { DEBOUNCE_MS, LISTED, fileKey, lineKey, listing, useSearch } = await import('../../src/renderer/search/searchStore');

const repo = (name: string): RepoView => ({
  name,
  path: `/w/${name}`,
  status: { head: 'main', headOid: 'a'.repeat(40), detached: false, unborn: false, upstream: null, ahead: null, behind: null, stashes: 0, files: [] },
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
});
const file = (path: string, lines: number[], stamp = 'a'.repeat(40)): TextFile => ({
  path,
  stamp,
  lines: lines.map((line) => ({ line, text: `x weeklyRank ${line}`, from: 0, cut: false, ranges: [[2, 12]], count: 1 })),
});
const done = (files: TextFile[]): TextSearchResult => ({ ok: true, files, count: files.reduce((sum, f) => sum + f.lines.length, 0), truncated: false });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useApp.setState({ workspace: { dir: '/w', repos: [repo('app'), repo('api')], ignored: 0, rootSessions: 0, refreshedAt: 1 }, unsaved: {}, center: { tabs: [], active: null, open: false }, rightTab: 'git' });
  useSearch.getState().reset();
  useSearch.setState({ form: { pattern: '', replacement: '', showReplace: false, matchCase: false, wholeWord: false, regex: false, include: '', repo: null } });
  for (const fn of Object.values(bridge.edi)) if (vi.isMockFunction(fn)) fn.mockReset();
});
afterEach(() => vi.useRealTimers());

async function searchFor(pattern: string, results: Record<string, TextSearchResult>) {
  bridge.edi.searchText.mockImplementation(async (repoPath) => results[repoPath] ?? done([]));
  useSearch.getState().setForm({ pattern });
  vi.advanceTimersByTime(DEBOUNCE_MS);
  vi.useRealTimers();
  await flush();
}

describe('searching', () => {
  it('searches every repository once typing pauses, and lists them in the project order', async () => {
    await searchFor('weeklyRank', { '/w/api': done([file('src/a.ts', [3])]), '/w/app': done([file('b.ts', [1, 2])]) });
    const calls = bridge.edi.searchText.mock.calls;
    expect(calls.map(([path, query]) => [path, query.pattern])).toEqual([
      ['/w/app', 'weeklyRank'],
      ['/w/api', 'weeklyRank'],
    ]);
    const { results, order, dismissed } = useSearch.getState();
    const list = listing(results, order, useApp.getState().workspace.repos, dismissed);
    expect(list.repos.map((r) => [r.name, r.count, r.files.map((f) => f.path)])).toEqual([
      ['app', 2, ['b.ts']],
      ['api', 1, ['src/a.ts']],
    ]);
    expect([list.count, list.files, list.searching]).toEqual([3, 2, 0]);
  });

  it('drops what an older search finds once a newer one started', async () => {
    let finishOld: (result: TextSearchResult) => void = () => undefined;
    bridge.edi.searchText.mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)));
    useSearch.getState().setForm({ pattern: 'old', repo: '/w/app' });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    bridge.edi.searchText.mockResolvedValue(done([file('new.ts', [1])]));
    useSearch.getState().setForm({ pattern: 'new' });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    vi.useRealTimers();
    await flush();
    finishOld(done([file('old.ts', [1])]));
    await flush();
    const results = useSearch.getState().results['/w/app'];
    expect(results?.state === 'done' && results.files.map((f) => f.path)).toEqual(['new.ts']);
  });

  it('does not search for a pattern that is not valid, and stops the search running', () => {
    bridge.edi.searchText.mockReturnValue(new Promise(() => undefined));
    useSearch.getState().setForm({ pattern: 'fetch' });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(bridge.edi.searchText).toHaveBeenCalledTimes(2);
    useSearch.getState().setForm({ pattern: 'fetch(', regex: true });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(bridge.edi.searchText).toHaveBeenCalledTimes(2);
    expect(bridge.edi.stopSearch).toHaveBeenCalledWith(useSearch.getState().serial);
    expect(useSearch.getState().ran).toBeNull();
  });
});

describe('listing', () => {
  it('leaves out dismissed files and lines, and stops at the limit', () => {
    const repos = [repo('app')];
    const found = (files: TextFile[]) => ({ state: 'done' as const, files, count: 0, truncated: false });
    const results = { '/w/app': found([file('a.ts', [1, 2]), file('b.ts', [4])]) };
    const list = listing(results, ['/w/app'], repos, { [fileKey('/w/app', 'b.ts')]: true, [lineKey('/w/app', 'a.ts', 1)]: true });
    expect(list.repos[0]!.files.map((f) => [f.path, f.lines.map((l) => l.line)])).toEqual([['a.ts', [2]]]);
    const many = found([file('big.ts', Array.from({ length: LISTED + 5 }, (_, n) => n + 1))]);
    const capped = listing({ '/w/app': many }, ['/w/app'], repos, {});
    expect(capped.count).toBe(LISTED);
    expect(capped.truncated).toBe(true);
  });
});

describe('replacing', () => {
  it('replaces a line, takes it off the list and keeps the new stamp', async () => {
    await searchFor('weeklyRank', { '/w/app': done([file('b.ts', [1, 2])]) });
    useSearch.getState().setForm({ replacement: 'weekRank' });
    bridge.edi.replaceText.mockResolvedValue({ ok: true, count: 1, stamp: 'b'.repeat(40) });
    await useSearch.getState().replaceLines('/w/app', 'b.ts', [2]);
    expect(bridge.edi.replaceText).toHaveBeenCalledWith('/w/app', 'b.ts', expect.objectContaining({ pattern: 'weeklyRank' }), 'weekRank', 'a'.repeat(40), [2]);
    const result = useSearch.getState().results['/w/app'];
    expect(result?.state === 'done' && result.files.map((f) => [f.stamp, f.lines.map((l) => l.line)])).toEqual([['b'.repeat(40), [1]]]);
  });

  it('says why a file was left alone', async () => {
    await searchFor('weeklyRank', { '/w/app': done([file('b.ts', [1])]) });
    bridge.edi.replaceText.mockResolvedValue({ ok: false, error: 'It changed after the search', changed: true });
    await useSearch.getState().replaceLines('/w/app', 'b.ts', null);
    expect(useSearch.getState().notice).toBe('Not replaced in app/b.ts: it changed after the search. Search again to include it.');
    useApp.setState({ unsaved: { 'file:/w/app:b.ts': true } });
    bridge.edi.replaceText.mockClear();
    await useSearch.getState().replaceLines('/w/app', 'b.ts', null);
    expect(bridge.edi.replaceText).not.toHaveBeenCalled();
    expect(useSearch.getState().notice).toBe('Not replaced in app/b.ts: it has unsaved edits in a tab.');
  });

  it('asks before Replace All, leaves tabs with unsaved edits alone and sums up', async () => {
    await searchFor('weeklyRank', { '/w/app': done([file('a.ts', [1, 2]), file('b.ts', [3])]), '/w/api': done([file('c.ts', [4])]) });
    useSearch.getState().setForm({ replacement: 'weekRank' });
    useApp.setState({ unsaved: { 'file:/w/api:c.ts': true } });
    bridge.edi.confirmReplaceAll.mockResolvedValue(true);
    bridge.edi.replaceText.mockImplementation(async (_repo, _path, _query, _replacement, _stamp, lines) => ({ ok: true, count: lines.length, stamp: 'c'.repeat(40) }));
    await useSearch.getState().replaceAll();
    expect(bridge.edi.confirmReplaceAll).toHaveBeenCalledWith({ count: 4, pattern: 'weeklyRank', replacement: 'weekRank', files: 3, repos: 2 });
    expect(bridge.edi.replaceText.mock.calls.map(([repoPath, path, , , , lines]) => [repoPath, path, lines])).toEqual([
      ['/w/app', 'a.ts', [1, 2]],
      ['/w/app', 'b.ts', [3]],
    ]);
    expect(useSearch.getState().done).toEqual({ count: 3, files: 2, skipped: ['Skipped api/c.ts: it has unsaved edits in a tab.'] });
  });

  it('changes nothing when Replace All is cancelled', async () => {
    await searchFor('weeklyRank', { '/w/app': done([file('a.ts', [1])]) });
    bridge.edi.confirmReplaceAll.mockResolvedValue(false);
    await useSearch.getState().replaceAll();
    expect(bridge.edi.replaceText).not.toHaveBeenCalled();
    expect(useSearch.getState().done).toBeNull();
  });
});

describe('focusSearch', () => {
  it('shows the Search tab, limited to the folder asked for', () => {
    useSearch.getState().focusSearch({ repo: '/w/app', include: 'src/**' });
    expect(useApp.getState().rightTab).toBe('search');
    expect(useSearch.getState().form).toEqual(expect.objectContaining({ repo: '/w/app', include: 'src/**' }));
    expect(useSearch.getState().focus).toBeGreaterThan(0);
  });
});
