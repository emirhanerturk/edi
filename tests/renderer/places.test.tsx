// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoView, WorkspaceView } from '../../src/shared/api';

vi.mock('../../src/renderer/bridge', () => ({ edi: { on: () => () => undefined, setUnsaved: vi.fn(), pty: { close: vi.fn() } } }));
vi.mock('../../src/renderer/terminals/terminals', () => ({
  openTerminal: vi.fn(async () => ({ id: 7, title: 'zsh' })),
  onTerminalTitle: vi.fn(),
  disposeTerminal: vi.fn(),
  disposeAllTerminals: vi.fn(),
  showTerminal: vi.fn(),
}));

const { useApp } = await import('../../src/renderer/store');
const { TabBar } = await import('../../src/renderer/terminals/TabBar');
const { placeMenuKey, tabPlaces } = await import('../../src/renderer/terminals/places');
const terminals = await import('../../src/renderer/terminals/terminals');
const realNewTab = useApp.getState().newTab;

afterEach(cleanup);

const repo = (name: string, path: string, claude = 0): RepoView => ({
  name,
  path,
  status: { head: name === 'quizei-admin' ? 'feat/user-table' : 'main', headOid: null, detached: false, unborn: false, upstream: null, ahead: null, behind: null, stashes: 0, files: [] },
  error: null,
  busy: null,
  claude,
  hasRemote: false,
});
const workspace = (repos: RepoView[], dir = '/Users/me/studios/quizei'): WorkspaceView => ({ dir, repos, ignored: 0, rootSessions: 0, refreshedAt: 1 });
const QUIZEI = workspace([repo('quizei-app', '/Users/me/studios/quizei/quizei-app', 1), repo('quizei-admin', '/Users/me/studios/quizei/quizei-admin')]);

describe('tabPlaces and placeMenuKey', () => {
  it('lists the project folder, then each repository that is not the folder itself', () => {
    expect(tabPlaces(QUIZEI, '~/studios/quizei')).toEqual([
      { repoPath: null, name: 'Project folder', hint: '~/studios/quizei', sessions: 0 },
      { repoPath: '/Users/me/studios/quizei/quizei-app', name: 'quizei-app', hint: 'main', sessions: 1 },
      { repoPath: '/Users/me/studios/quizei/quizei-admin', name: 'quizei-admin', hint: 'feat/user-table', sessions: 0 },
    ]);
    expect(tabPlaces(workspace([repo('edi', '/s/edi')], '/s/edi'), '~/s/edi')).toHaveLength(1);
  });

  it('reads ⌥⌘T and ⌥⇧⌘T by key position', () => {
    const key = (over: Partial<KeyboardEvent>) => ({ metaKey: true, altKey: true, ctrlKey: false, shiftKey: false, code: 'KeyT', ...over });
    expect(placeMenuKey(key({}))).toBe('shell');
    expect(placeMenuKey(key({ shiftKey: true }))).toBe('claude');
    expect(placeMenuKey(key({ altKey: false }))).toBeNull();
    expect(placeMenuKey(key({ code: 'KeyN' }))).toBeNull();
  });
});

describe('+ and ✳+ with repositories to choose from', () => {
  beforeEach(() => {
    useApp.setState({ tabs: [], activeTab: null, placeMenu: null, home: '/Users/me', workspace: QUIZEI });
  });

  it('lists where a Claude Code session can start, with the sessions open there, and starts it in the one picked', () => {
    const newTab = vi.fn(async () => undefined);
    useApp.setState({ newTab });
    render(<TabBar />);
    fireEvent.click(screen.getByTestId('new-claude'));
    expect(screen.getByText('START CLAUDE CODE IN')).toBeTruthy();
    const items = screen.getAllByTestId('place-item');
    expect(items.map((item) => item.querySelector('.place-name')!.textContent)).toEqual(['Project folder', 'quizei-app', 'quizei-admin']);
    expect(items[0]!.textContent).toContain('~/studios/quizei');
    expect(items[0]!.textContent).toContain('⇧⌘T');
    expect(items[1]!.querySelector('.place-sessions')!.textContent).toBe('1');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.click(items[2]!);
    expect(newTab).toHaveBeenCalledWith({ claude: true, repoPath: '/Users/me/studios/quizei/quizei-admin' });
    expect(useApp.getState().placeMenu).toBeNull();
  });

  it('opens a terminal in the project folder from its first row; Esc closes the list', () => {
    const newTab = vi.fn(async () => undefined);
    useApp.setState({ newTab });
    render(<TabBar />);
    fireEvent.click(screen.getByTestId('new-terminal'));
    expect(screen.getByText('OPEN A TERMINAL IN')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('place-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('new-terminal'));
    fireEvent.click(screen.getAllByTestId('place-item')[0]!);
    expect(newTab).toHaveBeenCalledWith({ claude: false });
  });

  it('opens the tab at once in a project that is one repository: there is nothing to choose', () => {
    const newTab = vi.fn(async () => undefined);
    useApp.setState({ newTab, workspace: workspace([repo('edi', '/s/edi')], '/s/edi') });
    render(<TabBar />);
    expect(screen.getByTestId('new-terminal').getAttribute('aria-haspopup')).toBeNull();
    fireEvent.click(screen.getByTestId('new-terminal'));
    fireEvent.click(screen.getByTestId('new-claude'));
    expect(newTab.mock.calls).toEqual([[], [{ claude: true }]]);
    expect(screen.queryByTestId('place-menu')).toBeNull();
  });
});

describe('a tab started in a repository', () => {
  it('shows the repository after its name; the project folder shows nothing', async () => {
    useApp.setState({ tabs: [], activeTab: null, workspace: QUIZEI, newTab: realNewTab });
    await useApp.getState().newTab({ repoPath: '/Users/me/studios/quizei/quizei-app' });
    await useApp.getState().newTab({ claude: true });
    expect(terminals.openTerminal).toHaveBeenCalledWith({ repoPath: '/Users/me/studios/quizei/quizei-app' });
    expect(useApp.getState().tabs.map((tab) => [tab.title, tab.place])).toEqual([
      ['zsh', 'quizei-app'],
      ['claude', undefined],
    ]);
    render(<TabBar />);
    expect(screen.getAllByTestId('tab-place').map((place) => place.textContent)).toEqual(['quizei-app']);
  });
});
