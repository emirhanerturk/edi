// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDraft, ProjectView } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    openUrl: vi.fn(async () => ({ ok: true as const, message: '' })),
    openProject: vi.fn(async () => ({ ok: true as const })),
    revealProject: vi.fn(async () => undefined),
    projectDraft: vi.fn(async (): Promise<ProjectDraft | null> => null),
    newProject: vi.fn(async (): Promise<ProjectDraft | null> => null),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp } = await import('../../src/renderer/store');
const { TitleBar } = await import('../../src/renderer/components/TitleBar');

const view = (id: string, over: Partial<ProjectView> = {}): ProjectView => ({
  id,
  dir: `/Users/me/studios/${id}`,
  name: id,
  logo: { kind: 'letter', color: 'purple' },
  links: [],
  openedAt: 1,
  repoCount: 1,
  logoUrl: null,
  exists: true,
  open: false,
  ...over,
});

const quizei = view('quizei', {
  name: 'Quizei',
  open: true,
  repoCount: 8,
  links: [
    { url: 'https://quizei.com/', label: 'Site' },
    { url: 'https://admin.quizei.com/', label: 'Admin' },
    { url: 'https://apps.apple.com/app/quizei', label: '' },
  ],
});

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState(initial, true);
  useApp.setState({
    home: '/Users/me',
    workspace: { dir: quizei.dir, repos: [], rootSessions: 0, refreshedAt: 0 },
    projects: [quizei, view('edi'), view('gone', { exists: false })],
  });
  for (const fn of Object.values(bridge.edi)) if (vi.isMockFunction(fn)) fn.mockClear();
});
afterEach(cleanup);

describe('TitleBar', () => {
  it('shows the app name while no project is open', () => {
    useApp.setState({ workspace: { dir: null, repos: [], rootSessions: 0, refreshedAt: 0 } });
    render(<TitleBar />);
    expect(screen.getByTestId('titlebar').textContent).toContain('edi');
    expect(screen.queryByTestId('project-button')).toBeNull();
  });

  it('shows the open project, its main link written out, and the others behind +N', () => {
    render(<TitleBar />);
    expect(screen.getByTestId('project-button').textContent).toBe('QQuizei');
    expect(screen.getByTestId('project-button').getAttribute('title')).toBe('~/studios/quizei');
    expect(screen.getByTestId('main-link').textContent).toBe('quizei.com');
    fireEvent.click(screen.getByTestId('main-link'));
    expect(bridge.edi.openUrl).toHaveBeenCalledWith('https://quizei.com/');
    expect(screen.getByRole('button', { name: '2 more links' }).textContent).toBe('+2');
  });

  it('a project without links shows no link at all', () => {
    useApp.setState({ projects: [{ ...quizei, links: [] }] });
    render(<TitleBar />);
    expect(screen.queryByTestId('main-link')).toBeNull();
    expect(screen.queryByTestId('links-more')).toBeNull();
  });

  it('+N lists every link, the main one starred first, and Edit links…', async () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTestId('links-more'));
    const menu = within(screen.getByTestId('links-menu'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Sitequizei.com',
      'Adminadmin.quizei.com',
      'apps.apple.com/app/quizei',
      'Edit links…',
    ]);
    // The star marks the main one.
    expect(within(menu.getAllByRole('menuitem')[0]!).getByRole('img', { name: 'Main link' })).toBeTruthy();
    expect(within(menu.getAllByRole('menuitem')[1]!).queryByRole('img')).toBeNull();
    fireEvent.click(menu.getByRole('menuitem', { name: /Admin/ }));
    expect(bridge.edi.openUrl).toHaveBeenCalledWith('https://admin.quizei.com/');
    expect(screen.queryByTestId('links-menu')).toBeNull();

    bridge.edi.projectDraft.mockResolvedValueOnce({ dir: quizei.dir, name: 'quizei', repoCount: 8, logos: [], links: [], taken: null });
    fireEvent.click(screen.getByTestId('links-more'));
    await act(async () => fireEvent.click(within(screen.getByTestId('links-menu')).getByRole('menuitem', { name: 'Edit links…' })));
    expect(useApp.getState().sheet).toMatchObject({ mode: 'edit', projectId: 'quizei' });
  });

  it('the project menu edits it, shows it in Finder, switches to another, and shows all projects', async () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTestId('project-button'));
    const menu = within(screen.getByTestId('project-menu'));
    expect(menu.getByText('~/studios/quizei · 8 repos')).toBeTruthy();
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Edit project…',
      'Reveal in Finder',
      'Eedi1 repo',
      'All projects⇧⌘O',
      'New project…⌘O',
    ]);
    await act(async () => fireEvent.click(menu.getByRole('menuitem', { name: /edi/ })));
    expect(bridge.edi.openProject).toHaveBeenCalledWith('edi');

    fireEvent.click(screen.getByTestId('project-button'));
    fireEvent.click(within(screen.getByTestId('project-menu')).getByRole('menuitem', { name: /All projects/ }));
    expect(useApp.getState().projectsShown).toBe(true);

    fireEvent.click(screen.getByTestId('project-button'));
    fireEvent.click(within(screen.getByTestId('project-menu')).getByRole('menuitem', { name: 'Reveal in Finder' }));
    expect(bridge.edi.revealProject).toHaveBeenCalledWith('quizei');
  });
});
