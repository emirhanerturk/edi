// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoStatus } from '../../src/git/types';
import type { SummaryRequest, SummaryResult } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    setUnsaved: vi.fn(),
    summarize: vi.fn<(id: number, request: SummaryRequest) => Promise<SummaryResult>>(),
    cancelSummary: vi.fn<(id: number) => void>(),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useSummaries, summaryKey, staleKeys, sparkState } = await import('../../src/renderer/summaries/summaryStore');
const { markdownBlocks, Markdown } = await import('../../src/renderer/summaries/Markdown');
const { SummaryCard, problemText } = await import('../../src/renderer/summaries/SummaryCard');
const { pullRequestUrl, MAX_URL } = await import('../../src/renderer/summaries/pullRequest');
const { useApp } = await import('../../src/renderer/store');

afterEach(cleanup);
beforeEach(() => {
  useSummaries.setState({ runs: {} });
  bridge.edi.summarize.mockReset();
  bridge.edi.cancelSummary.mockReset();
});

/** A summarize call that waits until the test settles it. */
function pending() {
  let settle!: (result: SummaryResult) => void;
  bridge.edi.summarize.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));
  return (result: SummaryResult) => act(async () => settle(result));
}

const done = (text: string, extra: Partial<SummaryResult & { ok: true }> = {}): SummaryResult => ({ ok: true, text, about: '4 commits', at: Date.now(), ...extra });

describe('markdownBlocks', () => {
  it('paragraphs, bullet and numbered lists, headings; an indented line continues its item', () => {
    expect(markdownBlocks('İlk paragraf\nsürüyor.\n\n- bir\n  devamı\n* iki\n\n1. sıra\n## Başlık')).toEqual([
      { type: 'p', text: 'İlk paragraf sürüyor.' },
      { type: 'ul', items: ['bir devamı', 'iki'] },
      { type: 'ol', items: ['sıra'] },
      { type: 'h', text: 'Başlık' },
    ]);
  });

  it('renders bold and code, and markup in the text as text', () => {
    const { container } = render(<Markdown text={'- **Seçim limiti:** `selectionLimit` artık <b>güncel</b>'} />);
    expect(container.querySelector('li strong')?.textContent).toBe('Seçim limiti:');
    expect(container.querySelector('li code')?.textContent).toBe('selectionLimit');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>güncel</b>');
  });
});

describe('the summary store', () => {
  it('runs, then keeps the result; asking again stops the run going there', async () => {
    const first = pending();
    const key = summaryKey.incoming('/w/app');
    const running = useSummaries.getState().start(key, { kind: 'incoming', repoPath: '/w/app' }, 'Claude Code is reading 4 commits…');
    expect(sparkState(useSummaries.getState().runs[key])).toBe('running');
    const firstId = bridge.edi.summarize.mock.calls[0]![0];

    const second = pending();
    const again = useSummaries.getState().start(key, { kind: 'incoming', repoPath: '/w/app' }, 'reading');
    expect(bridge.edi.cancelSummary).toHaveBeenCalledWith(firstId);
    await first({ ok: false, reason: 'cancelled', error: 'Cancelled' });
    expect(await running).toBeNull();
    await second(done('- Özet'));
    expect(await again).toEqual(expect.objectContaining({ ok: true, text: '- Özet' }));
    expect(sparkState(useSummaries.getState().runs[key])).toBe('on');
  });

  it('closing stops a run and leaves nothing; a cancelled run leaves nothing either', async () => {
    const settle = pending();
    const key = summaryKey.changes('/w/app');
    const running = useSummaries.getState().start(key, { kind: 'changes', repoPath: '/w/app' }, 'reading');
    useSummaries.getState().close(key);
    expect(bridge.edi.cancelSummary).toHaveBeenCalled();
    expect(useSummaries.getState().runs[key]).toBeUndefined();
    await settle({ ok: false, reason: 'cancelled', error: 'Cancelled' });
    expect(await running).toBeNull();
  });

  it('goes stale once pulled, committed, pushed or switched; another folder clears all', async () => {
    const status = (patch: Partial<RepoStatus>): RepoStatus => ({
      head: 'main',
      headOid: null,
      detached: false,
      unborn: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 4,
      stashes: 0,
      files: [{ path: 'a.ts', origPath: null, x: '.', y: 'M', kind: 'changed' }],
      ...patch,
    });
    const at = (patch: Partial<RepoStatus>) => [{ path: '/w/app', status: status(patch) }];
    expect(staleKeys(at({}), at({}))).toEqual([]);
    expect(staleKeys(at({}), at({ behind: 0 }))).toEqual([summaryKey.incoming('/w/app')]);
    expect(staleKeys(at({}), at({ files: [] }))).toEqual([summaryKey.changes('/w/app')]);
    expect(staleKeys(at({}), at({ ahead: 0 }))).toEqual([summaryKey.pullRequest('/w/app')]);
    expect(staleKeys(at({}), at({ head: 'feat/x' }))).toHaveLength(3);

    useSummaries.setState({ runs: { [summaryKey.commit('/w/app', 'a'.repeat(40))]: { id: 1, request: { kind: 'commit', repoPath: '/w/app', oid: 'a' }, reading: '', result: done('x') } } });
    useApp.setState({ workspace: { dir: '/w', repos: [], ignored: 0, rootSessions: 0, refreshedAt: 0 } });
    useApp.setState({ workspace: { dir: '/other', repos: [], ignored: 0, rootSessions: 0, refreshedAt: 0 } });
    expect(useSummaries.getState().runs).toEqual({});
  });
});

describe('SummaryCard', () => {
  const run = (result: SummaryResult | null) => ({ id: 1, request: { kind: 'incoming', repoPath: '/w/app' } as SummaryRequest, reading: 'Claude Code is reading 4 commits…', result });

  it('reading, with Cancel; then the result with its footer, again and close', () => {
    const onAgain = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<SummaryCard label="SUMMARY" run={run(null)} now={Date.now()} onAgain={onAgain} onClose={onClose} />);
    expect(screen.getByText('Claude Code is reading 4 commits…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<SummaryCard label="SUMMARY" run={run(done('- Bir **madde**'))} now={Date.now()} onAgain={onAgain} onClose={onClose} />);
    expect(screen.getByText('SUMMARY')).toBeTruthy();
    expect(screen.getByText('madde').tagName).toBe('STRONG');
    expect(screen.getByText('Claude Code · 4 commits · just now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Summarize again' }));
    expect(onAgain).toHaveBeenCalledTimes(1);
  });

  it("why there is no result: not installed (nothing to retry), a limit with its reset, or Claude Code's error", () => {
    const now = new Date(2026, 10, 26, 12, 0).getTime();
    expect(problemText({ ok: false, reason: 'missing', error: 'x' }, now).title).toBe("Claude Code isn't installed, or edi can't find it.");
    const limit = problemText({ ok: false, reason: 'limit', error: 'Claude Code has reached its 5-hour limit.', resetsAt: new Date(2026, 10, 26, 14, 20).getTime() }, now);
    expect(limit.detail).toBe('It resets today 14:20. The usage meter in the title bar shows the same.');
    render(<SummaryCard label="SUMMARY" run={run({ ok: false, reason: 'missing', error: 'x' })} now={now} onAgain={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    cleanup();
    render(<SummaryCard label="SUMMARY" run={run({ ok: false, reason: 'failed', error: 'Invalid API key · Please run /login' })} now={now} onAgain={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Invalid API key · Please run /login')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('pullRequestUrl', () => {
  it('fills in the title and description; a description too long for the address is left for Copy', () => {
    const url = pullRequestUrl('https://github.com/emir/app/compare/main...feat/badge', 'Show the badge', '## Summary\n- Adds it & more');
    expect(url).toBe('https://github.com/emir/app/compare/main...feat/badge?expand=1&title=Show%20the%20badge&body=%23%23%20Summary%0A-%20Adds%20it%20%26%20more');
    expect(pullRequestUrl('https://github.com/e/a/compare/main...x', 'T', 'x'.repeat(MAX_URL))).toBe('https://github.com/e/a/compare/main...x?expand=1&title=T');
  });
});

describe('waiting for a result', () => {
  it('a result that arrives after the place was closed is dropped', async () => {
    const settle = pending();
    const key = summaryKey.stash('/w/app', 'c'.repeat(40));
    const running = useSummaries.getState().start(key, { kind: 'stash', repoPath: '/w/app', oid: 'c'.repeat(40) }, 'reading');
    useSummaries.getState().close(key);
    await settle(done('Rozet denemesi'));
    expect(await running).toBeNull();
    await waitFor(() => expect(useSummaries.getState().runs[key]).toBeUndefined());
  });
});
