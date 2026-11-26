// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitSummary, FileChange, RepoStatus, StashEntry } from '../../src/git/types';
import type { RepoView, SummaryRequest, SummaryResult } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    setUnsaved: vi.fn(),
    summarize: vi.fn<(id: number, request: SummaryRequest) => Promise<SummaryResult>>(),
    cancelSummary: vi.fn<(id: number) => void>(),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { GitPanelView } = await import('../../src/renderer/git/GitPanelView');
const { useSummaries } = await import('../../src/renderer/summaries/summaryStore');

afterEach(cleanup);
beforeEach(() => {
  useSummaries.setState({ runs: {} });
  bridge.edi.summarize.mockReset();
  bridge.edi.cancelSummary.mockReset();
});

const status = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  head: 'feat/rank-badge',
  headOid: 'a'.repeat(40),
  detached: false,
  unborn: false,
  upstream: 'origin/feat/rank-badge',
  ahead: 0,
  behind: 0,
  stashes: 0,
  files: [],
  ...over,
});
const change = (path: string, x = '.', y = 'M'): FileChange => ({ path, origPath: null, x, y, kind: 'changed' });
const repo = (over: Partial<RepoStatus>): RepoView => ({ name: 'quizei-app', path: '/w/quizei-app', status: status(over), error: null, busy: null, claude: 0, hasRemote: true });
const commit = (subject: string): CommitSummary => ({ oid: subject.length.toString(16).padStart(40, '0'), short: '1a2b3c4', subject, authorName: 'Berkay', authorEmail: 'b@x', date: Date.now(), parents: 1, tags: [] });
const ok = (text: string, extra: Partial<SummaryResult & { ok: true }> = {}): SummaryResult => ({ ok: true, text, about: '4 commits', at: Date.now(), ...extra });

/** Claude Code's answer, given when the test says. */
function answer() {
  let settle!: (result: SummaryResult) => void;
  bridge.edi.summarize.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));
  return (result: SummaryResult) => act(async () => settle(result));
}

function renderRepo(target: RepoView, extra: Partial<Parameters<typeof GitPanelView>[0]> = {}) {
  const props = {
    repos: [target],
    expanded: { [target.path]: true },
    onToggle: vi.fn(),
    onDraft: vi.fn(),
    onOp: vi.fn(),
    summaries: true,
    loadIncoming: vi.fn(async () => ({ ok: true as const, commits: [commit('fix(selections): follow the latest count')] })),
    loadUnpushed: vi.fn(async () => ({ ok: true as const, commits: [commit('feat(ranking): show the weekly rank badge')], canUndo: true })),
    ...extra,
  };
  render(<GitPanelView {...props} />);
  return props;
}

describe('Claude summaries in the Git tab', () => {
  it('none without summaries', () => {
    render(<GitPanelView repos={[repo({ behind: 2, files: [change('a.ts')] })]} expanded={{ '/w/quizei-app': true }} onToggle={vi.fn()} />);
    expect(screen.queryByTestId('summarize-incoming')).toBeNull();
    expect(screen.queryByTestId('summarize-changes')).toBeNull();
    expect(screen.queryByTestId('write-message')).toBeNull();
  });

  it('INCOMING: the sparkle sums up what a pull brings; the card reads, then shows the summary', async () => {
    renderRepo(repo({ behind: 4 }));
    const settle = answer();
    fireEvent.click(screen.getByTestId('summarize-incoming'));
    expect(bridge.edi.summarize).toHaveBeenCalledWith(expect.any(Number), { kind: 'incoming', repoPath: '/w/quizei-app' });
    expect(within(screen.getByTestId('incoming-summary')).getByText('Claude Code is reading 4 commits…')).toBeTruthy();
    expect(screen.getByTestId('summarize-incoming').getAttribute('data-state')).toBe('running');
    await settle(ok('- **Seçim limiti:** En güncel sayıyı izliyor.'));
    const card = screen.getByTestId('incoming-summary');
    expect(within(card).getByText('Seçim limiti:').tagName).toBe('STRONG');
    expect(within(card).getByText('Claude Code · 4 commits · just now')).toBeTruthy();
    // The sparkle again closes it.
    fireEvent.click(screen.getByTestId('summarize-incoming'));
    expect(screen.queryByTestId('incoming-summary')).toBeNull();
  });

  it('CHANGES: on CHANGES, or on STAGED when everything is staged', async () => {
    renderRepo(repo({ files: [change('AdSlot.tsx', 'M', '.')] }));
    const staged = screen.getAllByTestId('file-group-head').find((head) => head.textContent?.includes('STAGED'))!;
    expect(within(staged).getByTestId('summarize-changes')).toBeTruthy();
    const settle = answer();
    fireEvent.click(screen.getByTestId('summarize-changes'));
    expect(bridge.edi.summarize).toHaveBeenCalledWith(expect.any(Number), { kind: 'changes', repoPath: '/w/quizei-app' });
    expect(screen.getByText('Claude Code is reading 1 changed file…')).toBeTruthy();
    await settle({ ok: false, reason: 'missing', error: 'x' });
    expect(within(screen.getByTestId('changes-summary')).getByText("Claude Code isn't installed, or edi can't find it.")).toBeTruthy();
  });

  it('the commit box: Claude Code writes the message; the box waits for it', async () => {
    const { onDraft } = renderRepo(repo({ files: [change('AdSlot.tsx')] }));
    const settle = answer();
    fireEvent.click(screen.getByTestId('write-message'));
    expect(bridge.edi.summarize).toHaveBeenCalledWith(expect.any(Number), { kind: 'message', repoPath: '/w/quizei-app' });
    const box = screen.getByTestId('commit-message') as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.placeholder).toBe('Claude Code is writing a message…');
    await settle(ok('feat(ads): fill an empty ad slot'));
    expect(onDraft).toHaveBeenCalledWith('/w/quizei-app', 'feat(ads): fill an empty ad slot');
    expect(box.readOnly).toBe(false);
    expect(useSummaries.getState().runs).toEqual({});
  });

  it('the commit box: nothing to write a message for in a clean repo; a failure shows under the box', async () => {
    renderRepo(repo({ files: [] }));
    expect((screen.getByTestId('write-message') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderRepo(repo({ files: [change('a.ts')] }));
    const settle = answer();
    fireEvent.click(screen.getByTestId('write-message'));
    await settle({ ok: false, reason: 'limit', error: 'Claude Code has reached its 5-hour limit.', resetsAt: null });
    expect(within(screen.getByTestId('message-problem')).getByText('Claude Code has reached its 5-hour limit.')).toBeTruthy();
  });

  it('UNPUSHED: drafts a pull request; Copy, and Push and open on GitHub with the text filled in', async () => {
    const onOpenPullRequest = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderRepo(repo({ ahead: 2 }), { onOpenPullRequest });
    const settle = answer();
    fireEvent.click(screen.getByTestId('draft-pull-request'));
    expect(bridge.edi.summarize).toHaveBeenCalledWith(expect.any(Number), { kind: 'pullRequest', repoPath: '/w/quizei-app' });
    await settle(ok('## Summary\n- Adds RankBadge.', { title: 'Show the weekly rank badge', compareUrl: 'https://github.com/emir/quizei-app/compare/main...feat/rank-badge' }));
    const card = screen.getByTestId('pull-request-draft');
    expect(within(card).getByText('Show the weekly rank badge')).toBeTruthy();
    expect(within(card).getByText(/## Summary/)).toBeTruthy();
    fireEvent.click(within(card).getByTestId('copy-pull-request'));
    expect(writeText).toHaveBeenCalledWith('Show the weekly rank badge\n\n## Summary\n- Adds RankBadge.');
    fireEvent.click(within(card).getByTestId('open-pull-request'));
    expect(onOpenPullRequest).toHaveBeenCalledWith('/w/quizei-app', expect.stringMatching(/compare\/main\.\.\.feat\/rank-badge\?expand=1&title=Show%20the%20weekly%20rank%20badge&body=/));
  });

  it('a stash: one line on hover, which can become its name', async () => {
    const stash: StashEntry = { oid: 'c'.repeat(40), index: 0, subject: 'WIP on main: 1a2b3c4 feat: x', message: null, branch: 'main', baseSubject: 'feat: x', date: Date.now(), untracked: false };
    const onRenameStash = vi.fn();
    renderRepo(repo({ stashes: 1 }), { loadStashes: vi.fn(async () => ({ ok: true as const, stashes: [stash] })), onRenameStash, single: true });
    // The stash list starts closed.
    fireEvent.click(screen.getAllByTestId('file-group-head').find((head) => head.textContent?.includes('STASHES'))!);
    await waitFor(() => expect(screen.getByTestId('stash-row')).toBeTruthy());
    const settle = answer();
    fireEvent.click(screen.getByTestId('summarize-stash'));
    expect(bridge.edi.summarize).toHaveBeenCalledWith(expect.any(Number), { kind: 'stash', repoPath: '/w/quizei-app', oid: 'c'.repeat(40) });
    expect(screen.getByText('Claude Code is reading this stash…')).toBeTruthy();
    await settle(ok('Rozet denemesi: toplam puan gösteriliyor'));
    fireEvent.click(screen.getByTestId('stash-use-name'));
    expect(onRenameStash).toHaveBeenCalledWith('/w/quizei-app', stash, 'Rozet denemesi: toplam puan gösteriliyor');
    expect(screen.queryByTestId('stash-summary')).toBeNull();
  });
});
