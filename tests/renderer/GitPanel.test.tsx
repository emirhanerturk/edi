// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChange, RepoStatus, StashEntry } from '../../src/git/types';
import { GitPanelView } from '../../src/renderer/git/GitPanelView';
import { changeTotal } from '../../src/renderer/git/model';
import type { RepoView, StashMenuAction } from '../../src/shared/api';

afterEach(cleanup);

const status = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  head: 'main',
  headOid: 'a'.repeat(40),
  detached: false,
  unborn: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  stashes: 0,
  files: [],
  ...over,
});
const file = (path: string, x: string, y: string, kind: FileChange['kind'] = 'changed'): FileChange => ({
  path,
  origPath: null,
  x,
  y,
  kind,
});
const repo = (name: string, over: Partial<RepoView> = {}): RepoView => ({
  name,
  path: `/w/${name}`,
  status: status(),
  error: null,
  busy: null,
  claude: 0,
  hasRemote: true,
  ...over,
});

const repos: RepoView[] = [
  repo('quizei-api', { status: status({ ahead: 1 }), claude: 1 }),
  repo('quizei-app', {
    status: status({
      head: 'feat/banner',
      files: [file('app/play.tsx', 'M', 'M'), file('lib/old.ts', '.', 'D'), file('new.ts', '?', '?', 'untracked')],
    }),
  }),
  repo('quizei-web', { status: status({ behind: 2 }) }),
  repo('broken', { status: null, error: 'fatal: not a git repository' }),
];

function renderPanel(expanded: Record<string, boolean> = {}) {
  const onToggle = vi.fn();
  render(<GitPanelView repos={repos} expanded={expanded} onToggle={onToggle} />);
  return { onToggle };
}
const row = (name: string) => screen.getAllByTestId('repo-row').find((el) => el.getAttribute('data-repo') === name)!;

describe('GitPanelView', () => {
  it("shows each repo's name, branch and sync button", () => {
    renderPanel();
    expect(screen.getAllByTestId('repo-row').map((el) => el.getAttribute('data-repo'))).toEqual([
      'quizei-api',
      'quizei-app',
      'quizei-web',
      'broken',
    ]);
    expect(within(row('quizei-api')).getByTestId('sync-button').textContent).toBe('Push 1');
    expect(within(row('quizei-web')).getByTestId('sync-button').textContent).toBe('Pull 2');
    expect(within(row('quizei-api')).getByLabelText('Claude Code session open')).toBeTruthy();
    expect(within(row('quizei-web')).queryByLabelText('Claude Code session open')).toBeNull();
    expect(within(row('quizei-api')).getByLabelText('Clean')).toBeTruthy();
  });

  it('a repo with changes starts expanded, its files listed in their groups', () => {
    renderPanel();
    const app = row('quizei-app');
    expect(app.getAttribute('aria-expanded')).toBe('true');
    expect(row('quizei-api').getAttribute('aria-expanded')).toBe('false');

    const files = screen.getAllByTestId('file-row');
    // Staged: play.tsx. Changes: play.tsx (partly), old.ts (deleted), new.ts.
    expect(files.map((el) => `${el.getAttribute('data-group')}:${el.getAttribute('data-path')}`)).toEqual([
      'staged:app/play.tsx',
      'changes:app/play.tsx',
      'changes:lib/old.ts',
      'changes:new.ts',
    ]);
    expect(within(files[0]!).getByText('partly staged')).toBeTruthy();
    expect(within(files[2]!).getByText('old.ts').className).toContain('deleted');
    expect(within(app).getByText('feat/banner')).toBeTruthy();
  });

  it('the Staged and Changes headers collapse and expand their files; the header buttons do not toggle', () => {
    renderPanel();
    const head = (title: string) => screen.getAllByTestId('file-group-head').find((el) => el.textContent?.startsWith(title))!;
    const groups = () => screen.getAllByTestId('file-row').map((el) => el.getAttribute('data-group'));
    expect(head('STAGED').getAttribute('aria-expanded')).toBe('true');
    expect(head('STAGED').querySelector('svg')).toBeTruthy();
    fireEvent.click(head('STAGED'));
    expect(head('STAGED').getAttribute('aria-expanded')).toBe('false');
    expect(groups()).toEqual(['changes', 'changes', 'changes']);
    fireEvent.click(within(head('CHANGES')).getByRole('button', { name: 'Stage all' }));
    expect(groups()).toEqual(['changes', 'changes', 'changes']);
    fireEvent.click(head('CHANGES'));
    expect(screen.queryAllByTestId('file-row')).toHaveLength(0);
    // The choice is kept when the panel draws again (the next status poll, or switching tabs).
    cleanup();
    renderPanel();
    expect(screen.queryAllByTestId('file-row')).toHaveLength(0);
    fireEvent.click(head('STAGED'));
    fireEvent.click(head('CHANGES'));
    expect(groups()).toEqual(['staged', 'changes', 'changes', 'changes']);
  });

  it('shows the error of an unreadable repo', () => {
    renderPanel();
    expect(within(row('broken')).getByText('fatal: not a git repository')).toBeTruthy();
  });

  it("the user's expand/collapse choice overrides the default", () => {
    const { onToggle } = renderPanel({ '/w/quizei-app': false, '/w/quizei-api': true });
    expect(row('quizei-app').getAttribute('aria-expanded')).toBe('false');
    expect(row('quizei-api').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryAllByTestId('file-row')).toHaveLength(0);
    expect(within(row('quizei-api')).getByText('No changes')).toBeTruthy();

    fireEvent.click(within(row('quizei-web')).getByTestId('repo-toggle'));
    expect(onToggle).toHaveBeenCalledWith('/w/quizei-web', true);
  });

  it('clicking empty space or the branch name on a repo row also toggles it; the buttons on the row do not', () => {
    const { onToggle } = renderPanel({ '/w/quizei-web': false });
    const head = row('quizei-web').querySelector('.repo-head') as HTMLElement;
    fireEvent.click(head);
    expect(onToggle).toHaveBeenLastCalledWith('/w/quizei-web', true);
    fireEvent.click(within(row('quizei-web')).getByText('main'));
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.click(within(row('quizei-web')).getByTestId('sync-button'));
    expect(onToggle).toHaveBeenCalledTimes(2);
    // The name button also toggles only once (it does not bubble up to the row for a second toggle).
    fireEvent.click(within(row('quizei-web')).getByTestId('repo-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  it('says so when there are no repos', () => {
    render(<GitPanelView repos={[]} expanded={{}} onToggle={() => undefined} />);
    expect(screen.getByText('No git repositories in this folder')).toBeTruthy();
  });

  it('"Unstage all" is disabled during conflicts: resetting the index would also erase the conflict record', () => {
    const merging = repo('merging', {
      status: status({ files: [file('README.md', 'U', 'U', 'conflicted'), file('clean.txt', 'A', '.')] }),
    });
    render(<GitPanelView repos={[merging]} expanded={{}} onToggle={() => undefined} />);
    const button = screen.getByTestId('unstage-all') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Resolve the conflicts first');
  });
});

describe('GitPanelView, opening files', () => {
  function renderOpen(selected: { repoPath: string; path: string } | null = null) {
    const onOpenFile = vi.fn();
    const onOp = vi.fn();
    render(<GitPanelView repos={repos} expanded={{}} onToggle={() => undefined} onOpenFile={onOpenFile} onOp={onOp} selected={selected} />);
    return { onOpenFile, onOp };
  }
  const fileRow = (group: string, path: string) =>
    screen.getAllByTestId('file-row').find((el) => el.getAttribute('data-group') === group && el.getAttribute('data-path') === path)!;

  it('a single click opens the file as a preview, a double-click as a pinned tab', () => {
    const { onOpenFile } = renderOpen();
    fireEvent.click(fileRow('changes', 'lib/old.ts'));
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', expect.objectContaining({ path: 'lib/old.ts' }), false);
    fireEvent.doubleClick(fileRow('changes', 'new.ts'));
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', expect.objectContaining({ path: 'new.ts', kind: 'untracked' }), true);
  });

  it('the Enter key opens it too', () => {
    const { onOpenFile } = renderOpen();
    fireEvent.keyDown(fileRow('changes', 'lib/old.ts'), { key: 'Enter' });
    expect(onOpenFile).toHaveBeenCalledWith('/w/quizei-app', expect.objectContaining({ path: 'lib/old.ts' }), false);
  });

  it('the stage button does not open the file', () => {
    const { onOpenFile, onOp } = renderOpen();
    const button = within(fileRow('changes', 'lib/old.ts')).getByTestId('stage-file');
    fireEvent.click(button);
    fireEvent.doubleClick(button);
    expect(onOp).toHaveBeenCalledTimes(1);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('the row of the file open in the center panel shows as selected', () => {
    renderOpen({ repoPath: '/w/quizei-app', path: 'app/play.tsx' });
    const current = screen.getAllByTestId('file-row').filter((el) => el.getAttribute('aria-current') === 'true');
    // A partly staged file is in both groups.
    expect(current.map((el) => el.getAttribute('data-group'))).toEqual(['staged', 'changes']);
  });

  it('the same path in another repo does not count as selected', () => {
    renderOpen({ repoPath: '/w/quizei-web', path: 'app/play.tsx' });
    expect(screen.getAllByTestId('file-row').filter((el) => el.getAttribute('aria-current') === 'true')).toHaveLength(0);
  });
});

describe('GitPanelView, conflicted files', () => {
  it('a conflicted file can be opened in Zed; the button does not open it in the center panel', () => {
    const merging = repo('merging', { status: status({ files: [file('README.md', 'U', 'U', 'conflicted')] }) });
    const onOpenInZed = vi.fn();
    const onOpenFile = vi.fn();
    render(<GitPanelView repos={[merging]} expanded={{}} onToggle={() => undefined} onOpenInZed={onOpenInZed} onOpenFile={onOpenFile} />);
    const button = screen.getByRole('button', { name: 'Open README.md in Zed' });
    fireEvent.click(button);
    expect(onOpenInZed).toHaveBeenCalledWith('/w/merging', 'README.md');
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('no such button on a file without conflicts', () => {
    render(<GitPanelView repos={repos} expanded={{}} onToggle={() => undefined} onOpenInZed={() => undefined} />);
    expect(screen.queryByRole('button', { name: /in Zed$/ })).toBeNull();
  });
});

describe('changeTotal', () => {
  it('the badge counts distinct changed files', () => {
    expect(changeTotal(repos)).toBe(3);
    expect(changeTotal([])).toBe(0);
  });
});

describe('Unpushed commits', () => {
  afterEach(cleanup);
  const commit = (n: number, subject: string) => ({
    oid: String(n).repeat(40),
    short: String(n).repeat(7),
    subject,
    authorName: 'Ada',
    authorEmail: 'ada@x.dev',
    date: Date.now() - 2 * 3_600_000,
    parents: 1,
    tags: [],
  });
  const ahead = repo('api', { status: status({ ahead: 2, headOid: '2'.repeat(40) }) });
  const list = { ok: true as const, commits: [commit(2, 'feat: second'), commit(1, 'feat: first')], canUndo: true };

  function renderUnpushed(target: RepoView = ahead, result: typeof list | { ok: true; commits: []; canUndo: false } = list) {
    const loadUnpushed = vi.fn(async () => result);
    const onOpenCommit = vi.fn();
    const onUndoCommit = vi.fn();
    render(
      <GitPanelView
        repos={[target]}
        expanded={{ [target.path]: true }}
        onToggle={() => undefined}
        loadUnpushed={loadUnpushed}
        onOpenCommit={onOpenCommit}
        onUndoCommit={onUndoCommit}
      />,
    );
    return { loadUnpushed, onOpenCommit, onUndoCommit };
  }

  it('an expanded repo ahead of its upstream lists the commits under UNPUSHED', async () => {
    const { loadUnpushed } = renderUnpushed();
    expect(loadUnpushed).toHaveBeenCalledWith('/w/api');
    const rows = await screen.findAllByTestId('unpushed-row');
    expect(rows.map((el) => el.textContent)).toEqual([expect.stringContaining('feat: second'), expect.stringContaining('feat: first')]);
    expect(rows[0]!.textContent).toContain('2222222');
    expect(rows[0]!.textContent).toContain('2h');
    const head = screen.getAllByTestId('file-group-head').find((el) => el.textContent?.includes('UNPUSHED'))!;
    expect(head.textContent).toContain('2');
  });

  it('clicking a commit opens it (double click pins); only the newest has Undo', async () => {
    const { onOpenCommit, onUndoCommit } = renderUnpushed();
    const rows = await screen.findAllByTestId('unpushed-row');
    fireEvent.click(rows[1]!);
    expect(onOpenCommit).toHaveBeenLastCalledWith('/w/api', '1'.repeat(40), false);
    fireEvent.doubleClick(rows[0]!);
    expect(onOpenCommit).toHaveBeenLastCalledWith('/w/api', '2'.repeat(40), true);
    expect(screen.getAllByTestId('undo-commit')).toHaveLength(1);
    expect(within(rows[0]!).getByTestId('undo-commit')).toBeTruthy();
    onOpenCommit.mockClear();
    fireEvent.click(within(rows[0]!).getByTestId('undo-commit'));
    expect(onUndoCommit).toHaveBeenCalledWith('/w/api', list.commits[0]);
    expect(onOpenCommit).not.toHaveBeenCalled();
  });

  it('no Undo when the newest cannot be undone (a merge)', async () => {
    renderUnpushed(ahead, { ...list, canUndo: false } as never);
    await screen.findAllByTestId('unpushed-row');
    expect(screen.queryByTestId('undo-commit')).toBeNull();
  });

  it('no section, and nothing loaded, when nothing is ahead or there is no upstream', () => {
    const { loadUnpushed } = renderUnpushed(repo('clean', { status: status({ ahead: 0 }) }));
    cleanup();
    const second = renderUnpushed(repo('lone', { status: status({ ahead: null, upstream: null }) }));
    expect(loadUnpushed).not.toHaveBeenCalled();
    expect(second.loadUnpushed).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unpushed-row')).toBeNull();
  });
});

describe('Incoming commits', () => {
  afterEach(cleanup);
  const commit = (n: number, subject: string, authorName: string) => ({
    oid: String(n).repeat(40),
    short: String(n).repeat(7),
    subject,
    authorName,
    authorEmail: `${authorName.toLowerCase()}@x.dev`,
    date: Date.now() - 3 * 60_000,
    parents: 1,
    tags: [],
  });
  const behind = repo('api', { status: status({ behind: 2, ahead: 1 }) });
  const list = { ok: true as const, commits: [commit(4, 'fix(ads): consent mode', 'Berkay'), commit(3, 'feat: sync', 'Berkay')] };

  function renderIncoming(target: RepoView = behind, selected: { repoPath: string; path: string; kind: string } | null = null) {
    const loadIncoming = vi.fn(async () => list);
    const loadUnpushed = vi.fn(async () => ({ ok: true as const, commits: [commit(5, 'feat: mine', 'Me')], canUndo: true }));
    const onOpenCommit = vi.fn();
    render(
      <GitPanelView
        repos={[target]}
        expanded={{ [target.path]: true }}
        onToggle={() => undefined}
        loadIncoming={loadIncoming}
        loadUnpushed={loadUnpushed}
        onOpenCommit={onOpenCommit}
        selected={selected}
      />,
    );
    return { loadIncoming, onOpenCommit };
  }

  it('a repo behind its upstream lists what Pull would bring, with who made each, above UNPUSHED', async () => {
    const { loadIncoming } = renderIncoming();
    expect(loadIncoming).toHaveBeenCalledWith('/w/api');
    const rows = await screen.findAllByTestId('incoming-row');
    expect(rows.map((el) => el.textContent)).toEqual([expect.stringContaining('fix(ads): consent mode'), expect.stringContaining('feat: sync')]);
    expect(rows[0]!.textContent).toContain('Berkay');
    expect(rows[0]!.textContent).toContain('3m');
    expect(within(rows[0]!).getByTitle('Berkay <berkay@x.dev>')).toBeTruthy();
    const head = screen.getAllByTestId('file-group-head').find((el) => el.textContent?.includes('INCOMING'))!;
    expect(head.textContent).toContain('2');
    expect(head.textContent).toContain('origin/main');
    const groups = screen.getAllByTestId(/^(incoming|unpushed)-group$/).map((el) => el.dataset.testid);
    expect(groups).toEqual(['incoming-group', 'unpushed-group']);
  });

  it('clicking one opens it in the commit view (double click pins); the open one is marked', async () => {
    const { onOpenCommit } = renderIncoming(behind, { repoPath: '/w/api', path: '3'.repeat(40), kind: 'commit' });
    const rows = await screen.findAllByTestId('incoming-row');
    expect(rows.map((el) => el.getAttribute('aria-current'))).toEqual([null, 'true']);
    fireEvent.click(rows[0]!);
    expect(onOpenCommit).toHaveBeenLastCalledWith('/w/api', '4'.repeat(40), false);
    fireEvent.doubleClick(rows[1]!);
    expect(onOpenCommit).toHaveBeenLastCalledWith('/w/api', '3'.repeat(40), true);
  });

  it('no section, and nothing loaded, when nothing is behind or there is no upstream', () => {
    const { loadIncoming } = renderIncoming(repo('even', { status: status({ behind: 0 }) }));
    cleanup();
    const second = renderIncoming(repo('lone', { status: status({ behind: null, upstream: null }) }));
    expect(loadIncoming).not.toHaveBeenCalled();
    expect(second.loadIncoming).not.toHaveBeenCalled();
    expect(screen.queryByTestId('incoming-group')).toBeNull();
  });
});

describe('Stashes', () => {
  afterEach(cleanup);
  const entry = (n: number, over: Partial<StashEntry> = {}): StashEntry => ({
    oid: String(n % 10).repeat(40),
    index: n,
    subject: `On main: stash ${n}`,
    message: `stash ${n}`,
    branch: 'main',
    baseSubject: null,
    date: Date.now() - (n + 1) * 3_600_000,
    untracked: false,
    ...over,
  });
  const wip = entry(1, { subject: 'WIP on feat/login: 1a2b3c4 feat: add login form', message: null, branch: 'feat/login', baseSubject: 'feat: add login form' });
  const two = [entry(0, { message: 'fix spacing on mobile', subject: 'On main: fix spacing on mobile' }), wip];

  function renderStashes(target: RepoView, opts: { stashes?: StashEntry[]; single?: boolean; menuPick?: StashMenuAction | null; open?: boolean } = {}) {
    const loadStashes = vi.fn(async () => ({ ok: true as const, stashes: opts.stashes ?? two }));
    const onOpenStash = vi.fn();
    const onStashAction = vi.fn();
    const onOp = vi.fn();
    const stashMenu = vi.fn(async () => opts.menuPick ?? null);
    render(
      <GitPanelView
        repos={[target]}
        expanded={{}}
        onToggle={() => undefined}
        single={opts.single}
        loadStashes={loadStashes}
        onOpenStash={onOpenStash}
        onStashAction={onStashAction}
        stashMenu={stashMenu}
        onOp={onOp}
      />,
    );
    // STASHES starts closed; opened by hand, it stays open for the session.
    const head = stashesHead();
    if (opts.open !== false && head?.getAttribute('aria-expanded') === 'false') fireEvent.click(head);
    return { loadStashes, onOpenStash, onStashAction, onOp, stashMenu };
  }
  const stashesHead = () => screen.queryAllByTestId('file-group-head').find((el) => el.textContent?.includes('STASHES'));
  const changed = (over: Partial<RepoStatus> = {}) =>
    repo('app', { status: status({ stashes: 2, files: [file('a.ts', '.', 'M'), file('new.ts', '?', '?', 'untracked')], ...over }) });

  it('a collapsed repo shows how many stashes it has; nothing is read until it opens', () => {
    const { loadStashes } = renderStashes(repo('api', { status: status({ stashes: 2 }) }));
    expect(screen.getByTestId('repo-stashes').textContent).toBe('2');
    expect(screen.getByTestId('repo-stashes').title).toBe('2 stashes');
    expect(row('api').getAttribute('aria-expanded')).toBe('false');
    expect(loadStashes).not.toHaveBeenCalled();
    cleanup();
    renderStashes(repo('api'));
    expect(screen.queryByTestId('repo-stashes')).toBeNull();
  });

  it('STASHES starts closed when a repo opens; opened by hand, it stays open', async () => {
    const fresh = () => repo('fresh', { status: status({ stashes: 2, files: [file('a.ts', '.', 'M')] }) });
    renderStashes(fresh(), { open: false });
    expect(stashesHead()!.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByTestId('stash-row')).toHaveLength(0);
    fireEvent.click(stashesHead()!);
    expect(await screen.findAllByTestId('stash-row')).toHaveLength(2);
    cleanup();
    renderStashes(fresh(), { open: false });
    expect(stashesHead()!.getAttribute('aria-expanded')).toBe('true');
  });

  it('lists the stashes under STASHES: the message, or WIP and its base; the branch only when it is another one', async () => {
    const { loadStashes } = renderStashes(changed());
    expect(loadStashes).toHaveBeenCalledWith('/w/app');
    const rows = await screen.findAllByTestId('stash-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('fix spacing on mobile');
    expect(rows[0]!.querySelector('.stash-branch')).toBeNull();
    expect(within(rows[1]!).getByText('WIP')).toBeTruthy();
    expect(within(rows[1]!).getByText('feat: add login form')).toBeTruthy();
    expect(rows[1]!.querySelector('.stash-branch')?.textContent).toBe('feat/login');
    expect(rows[1]!.title).toBe('stash@{1}: WIP on feat/login: 1a2b3c4 feat: add login form');
    const head = screen.getAllByTestId('file-group-head').find((el) => el.textContent?.includes('STASHES'))!;
    expect(head.textContent).toContain('2');
  });

  it('a click previews a stash, a double click pins it; Pop pops without opening', async () => {
    const { onOpenStash, onStashAction } = renderStashes(changed());
    const rows = await screen.findAllByTestId('stash-row');
    fireEvent.click(rows[1]!);
    expect(onOpenStash).toHaveBeenLastCalledWith('/w/app', wip, false);
    fireEvent.doubleClick(rows[0]!);
    expect(onOpenStash).toHaveBeenLastCalledWith('/w/app', two[0], true);
    onOpenStash.mockClear();
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Pop stash WIP on feat/login' }));
    expect(onStashAction).toHaveBeenCalledWith('/w/app', wip, 'pop');
    expect(onOpenStash).not.toHaveBeenCalled();
  });

  it('right-click opens the stash menu; its pick is run on that stash', async () => {
    const { stashMenu, onStashAction } = renderStashes(changed(), { menuPick: 'drop' });
    const rows = await screen.findAllByTestId('stash-row');
    fireEvent.contextMenu(rows[0]!);
    expect(stashMenu).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(onStashAction).toHaveBeenCalledWith('/w/app', two[0], 'drop'));
  });

  it('during a conflict Pop is disabled and the menu greys out Pop and Apply', async () => {
    const { stashMenu } = renderStashes(changed({ files: [file('a.ts', 'U', 'U', 'conflicted')] }));
    const rows = await screen.findAllByTestId('stash-row');
    const pop = within(rows[0]!).getByTestId('stash-pop') as HTMLButtonElement;
    expect(pop.disabled).toBe(true);
    expect(pop.title).toBe('Resolve the conflicts first');
    fireEvent.contextMenu(rows[0]!);
    expect(stashMenu).toHaveBeenCalledWith(false);
  });

  it('with several repos the newest five show until "Show N more"; a single repo lists them all', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => entry(i));
    renderStashes(changed({ stashes: 7 }), { stashes: seven });
    expect(await screen.findAllByTestId('stash-row')).toHaveLength(5);
    fireEvent.click(screen.getByTestId('stash-more'));
    expect(screen.getAllByTestId('stash-row')).toHaveLength(7);
    expect(screen.queryByTestId('stash-more')).toBeNull();
    cleanup();
    renderStashes(repo('solo', { status: status({ stashes: 7, files: [file('a.ts', '.', 'M')] }) }), { stashes: seven, single: true });
    expect(await screen.findAllByTestId('stash-row')).toHaveLength(7);
    expect(screen.queryByTestId('stash-more')).toBeNull();
  });

  it('a clean single repo with stashes starts expanded; with several repos it stays collapsed', async () => {
    renderStashes(repo('solo', { status: status({ stashes: 2 }) }), { single: true });
    expect(row('solo').getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findAllByTestId('stash-row')).toHaveLength(2);
    expect(within(row('solo')).getByText('No changes')).toBeTruthy();
    cleanup();
    renderStashes(repo('solo', { status: status({ stashes: 2 }) }));
    expect(row('solo').getAttribute('aria-expanded')).toBe('false');
    cleanup();
    renderStashes(repo('solo', { status: status() }), { single: true });
    expect(row('solo').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Stash button', () => {
  afterEach(cleanup);
  function renderButton(files: FileChange[], over: Partial<RepoStatus> = {}) {
    const onOp = vi.fn();
    render(<GitPanelView repos={[repo('app', { status: status({ files, ...over }) })]} expanded={{}} onToggle={() => undefined} onOp={onOp} />);
    return { onOp };
  }

  it('opens a menu with a message field; Enter stashes every change with that message', () => {
    const { onOp } = renderButton([file('a.ts', '.', 'M'), file('new.ts', '?', '?', 'untracked')]);
    fireEvent.click(screen.getByTestId('stash-button'));
    const menu = screen.getByRole('menu', { name: 'Stash' });
    expect(within(menu).getByRole('menuitem', { name: /Stash all changes/ }).textContent).toContain('2 files');
    // Nothing is staged: no "staged" choice.
    expect(within(menu).queryByRole('menuitem', { name: /Stash staged changes/ })).toBeNull();
    const input = within(menu).getByLabelText('Stash message');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '  wip: login  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOp).toHaveBeenCalledWith('/w/app', { op: 'stash', message: 'wip: login', staged: false });
    expect(screen.queryByRole('menu', { name: 'Stash' })).toBeNull();
  });

  it('offers the staged changes alone when something else is not staged, unless a file is partly staged', () => {
    const { onOp } = renderButton([file('a.ts', 'M', '.'), file('b.ts', '.', 'M')]);
    fireEvent.click(screen.getByTestId('stash-button'));
    const staged = screen.getByRole('menuitem', { name: /Stash staged changes/ }) as HTMLButtonElement;
    expect(staged.textContent).toContain('1 file');
    fireEvent.click(staged);
    expect(onOp).toHaveBeenCalledWith('/w/app', { op: 'stash', message: '', staged: true });
    cleanup();

    renderButton([file('a.ts', 'M', 'M')]);
    fireEvent.click(screen.getByTestId('stash-button'));
    expect((screen.getByRole('menuitem', { name: /Stash staged changes/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    // Everything is staged: "staged" would be the same as "all".
    renderButton([file('a.ts', 'M', '.')]);
    fireEvent.click(screen.getByTestId('stash-button'));
    expect(screen.queryByRole('menuitem', { name: /Stash staged changes/ })).toBeNull();
  });

  it('is disabled during a conflict and absent before the first commit', () => {
    renderButton([file('a.ts', 'U', 'U', 'conflicted')]);
    const button = screen.getByTestId('stash-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Resolve the conflicts first');
    cleanup();
    renderButton([file('a.ts', 'A', '.')], { unborn: true, headOid: null });
    expect(screen.getByTestId('commit-button')).toBeTruthy();
    expect(screen.queryByTestId('stash-button')).toBeNull();
  });
});

describe('Stash and switch', () => {
  afterEach(cleanup);
  it('a switch refused because of local changes offers to stash them and switch again', () => {
    const onOp = vi.fn();
    const target = repo('app', { status: status({ files: [file('a.ts', '.', 'M')] }) });
    const error = 'error: Your local changes to the following files would be overwritten by checkout:';
    render(
      <GitPanelView
        repos={[target]}
        expanded={{}}
        onToggle={() => undefined}
        onOp={onOp}
        errors={{ '/w/app': error }}
        retries={{ '/w/app': { op: 'switch', branch: 'feat/x' } }}
      />,
    );
    expect(screen.getByText('Local changes are in the way')).toBeTruthy();
    fireEvent.click(screen.getByTestId('stash-retry'));
    expect(screen.getByTestId('stash-retry').textContent).toBe('Stash and switch');
    expect(onOp).toHaveBeenCalledWith('/w/app', { op: 'stash', message: '', staged: false, then: { op: 'switch', branch: 'feat/x' } });
  });

  it('a refused pull says "Stash and pull"; without a retry there is no such button', () => {
    const target = repo('app', { status: status({ files: [file('a.ts', '.', 'M')] }) });
    render(<GitPanelView repos={[target]} expanded={{}} onToggle={() => undefined} errors={{ '/w/app': 'x' }} retries={{ '/w/app': { op: 'pull' } }} />);
    expect(screen.getByTestId('stash-retry').textContent).toBe('Stash and pull');
    cleanup();
    render(<GitPanelView repos={[target]} expanded={{}} onToggle={() => undefined} errors={{ '/w/app': 'x' }} />);
    expect(screen.queryByTestId('stash-retry')).toBeNull();
  });
});

describe('a detached HEAD', () => {
  it('offers the branch menu, to switch back to a branch or make one at this commit', async () => {
    const onOp = vi.fn();
    const detached = repo('quizei-app', { status: status({ head: '1a2b3c4', detached: true, upstream: null, ahead: null, behind: null }) });
    const loadBranches = async () => ({
      ok: true as const,
      current: null,
      branches: [{ name: 'main', ahead: 0, behind: 0, updatedAt: Date.now() }],
    });
    render(<GitPanelView repos={[detached]} expanded={{ '/w/quizei-app': true }} onToggle={vi.fn()} onOp={onOp} loadBranches={loadBranches} />);
    const button = within(row('quizei-app')).getByTestId('branch-button');
    expect(button.textContent).toBe('1a2b3c4');
    expect(button.title).toBe('Detached HEAD at 1a2b3c4: pick a branch to switch back');
    fireEvent.click(button);
    const main = await screen.findByRole('menuitem', { name: /main/ });
    // Nothing is checked: no branch is the current one.
    expect(main.querySelector('.menu-check svg')).toBeNull();
    fireEvent.click(main);
    expect(onOp).toHaveBeenCalledWith('/w/quizei-app', { op: 'switch', branch: 'main' });
  });
});
