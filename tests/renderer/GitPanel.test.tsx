// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChange, RepoStatus } from '../../src/git/types';
import { GitPanelView } from '../../src/renderer/git/GitPanelView';
import { changeTotal } from '../../src/renderer/git/model';
import type { RepoView } from '../../src/shared/api';

afterEach(cleanup);

const status = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  head: 'main',
  headOid: 'a'.repeat(40),
  detached: false,
  unborn: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
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
