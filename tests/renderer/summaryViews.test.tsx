// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitSummary } from '../../src/git/types';
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

const { HistoryPanelView } = await import('../../src/renderer/history/HistoryPanel');
const { dayCommits, DAY_SUMMARY_MAX } = await import('../../src/renderer/history/model');
const { ExplainButton } = await import('../../src/renderer/summaries/ExplainButton');
const { PlaceCard } = await import('../../src/renderer/summaries/places');
const { useSummaries, summaryKey } = await import('../../src/renderer/summaries/summaryStore');
type HistoryRow = import('../../src/renderer/history/model').HistoryRow;

afterEach(cleanup);
beforeEach(() => {
  useSummaries.setState({ runs: {} });
  bridge.edi.summarize.mockReset();
});

function answer() {
  let settle!: (result: SummaryResult) => void;
  bridge.edi.summarize.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));
  return (result: SummaryResult) => act(async () => settle(result));
}

const commit = (n: number): CommitSummary => ({ oid: String(n).padStart(40, 'a'), short: String(n), subject: `feat: ${n}`, authorName: 'Me', authorEmail: 'me@x', date: Date.now(), parents: 1, tags: [] });
const row = (n: number, repoName: string, unpushed = false): HistoryRow => ({ type: 'commit', repoName, repoPath: `/w/${repoName}`, commit: commit(n), unpushed, author: null, merge: false, tag: null });

const rows: HistoryRow[] = [
  { type: 'day', label: 'TODAY', first: true },
  row(1, 'quizei-backend'),
  row(2, 'quizei-app', true),
  { type: 'release', repoName: 'quizei-frontend', repoPath: '/w/quizei-frontend', commit: commit(3), tag: '1.88.0' },
  row(4, 'quizei-backend'),
  { type: 'day', label: 'YESTERDAY', first: false },
  row(5, 'quizei-app'),
];

describe("a History day's commits", () => {
  it('by repository in the order they show, with those not pushed yet, up to the next day', () => {
    expect(dayCommits(rows, 0)).toEqual([
      { repoPath: '/w/quizei-backend', oids: [commit(1).oid, commit(4).oid], unpushed: [] },
      { repoPath: '/w/quizei-app', oids: [commit(2).oid], unpushed: [commit(2).oid] },
      { repoPath: '/w/quizei-frontend', oids: [commit(3).oid], unpushed: [] },
    ]);
    expect(dayCommits(rows, 5)).toEqual([{ repoPath: '/w/quizei-app', oids: [commit(5).oid], unpushed: [] }]);
    const many: HistoryRow[] = [{ type: 'day', label: 'TODAY', first: true }, ...Array.from({ length: DAY_SUMMARY_MAX + 5 }, (_, i) => row(i, 'app'))];
    expect(dayCommits(many, 0)[0]!.oids).toHaveLength(DAY_SUMMARY_MAX);
  });

  it("the day's sparkle sums it up, and the card opens under its header", async () => {
    render(
      <HistoryPanelView
        layout="timeline"
        rows={rows}
        groups={[]}
        now={Date.now()}
        single={false}
        branch={null}
        repos={[]}
        filter={null}
        loading={false}
        errors={[]}
        canLoadMore={false}
        selected={null}
        onOpenCommit={vi.fn()}
        onFilter={vi.fn()}
        onLayout={vi.fn()}
        onLoadMore={vi.fn()}
        summaries={{ dir: '/w', filter: null }}
      />,
    );
    const settle = answer();
    fireEvent.click(screen.getAllByTestId('summarize-day')[0]!);
    expect(bridge.edi.summarize).toHaveBeenCalledWith(expect.any(Number), { kind: 'day', label: 'TODAY', commits: dayCommits(rows, 0) });
    expect(screen.getByText('Claude Code is reading 4 commits…')).toBeTruthy();
    await settle({ ok: true, text: '- **quizei-backend:** Seçim limitleri düzeltildi.', about: '4 commits in 3 repositories', at: Date.now() });
    const card = screen.getByTestId('day-summary');
    expect(within(card).getByText('TODAY')).toBeTruthy();
    expect(within(card).getByText('Claude Code · 4 commits in 3 repositories · just now')).toBeTruthy();
  });
});

describe("the commit view's Explain", () => {
  it('explains the commit; the button says so while it runs and closes the explanation after', async () => {
    const place = { key: summaryKey.commit('/w/app', 'e41c09a'), request: { kind: 'commit', repoPath: '/w/app', oid: 'e41c09a' } as SummaryRequest, reading: 'Claude Code is reading this commit…' };
    render(
      <>
        <ExplainButton place={place} />
        <PlaceCard place={place} label="EXPLANATION" className="wide" againLabel="Explain again" testId="commit-explanation" />
      </>,
    );
    const settle = answer();
    fireEvent.click(screen.getByTestId('explain-commit'));
    expect(screen.getByTestId('explain-commit').textContent).toBe('Explaining…');
    await settle({ ok: true, text: 'Bu birleştirme seçim limitlerini düzeltiyor.\n\n**Dikkat:** sütun kalıyor.', about: '3 commits, 6 files', at: Date.now() });
    const card = screen.getByTestId('commit-explanation');
    expect(card.className).toContain('wide');
    expect(within(card).getByText('Dikkat:').tagName).toBe('STRONG');
    expect(screen.getByTestId('explain-commit').getAttribute('data-state')).toBe('on');
    fireEvent.click(screen.getByTestId('explain-commit'));
    expect(screen.queryByTestId('commit-explanation')).toBeNull();
  });
});
