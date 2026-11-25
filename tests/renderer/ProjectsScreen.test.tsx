// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDraft, ProjectView } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    newProject: vi.fn(async (): Promise<ProjectDraft | null> => null),
    openProject: vi.fn(async () => ({ ok: true as const })),
    projectMenu: vi.fn(async (): Promise<string | null> => null),
    projectDraft: vi.fn(async (): Promise<ProjectDraft | null> => null),
    removeProject: vi.fn(async () => ({ ok: true as const })),
    locateProject: vi.fn(async () => ({ ok: true as const })),
    revealProject: vi.fn(async () => undefined),
    openUrl: vi.fn(async () => ({ ok: true as const, message: '' })),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp } = await import('../../src/renderer/store');
const { ProjectsScreen } = await import('../../src/renderer/projects/ProjectsScreen');

const view = (id: string, over: Partial<ProjectView> = {}): ProjectView => ({
  id,
  dir: `/Users/me/studios/${id}`,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  logo: { kind: 'letter', color: 'purple' },
  links: [],
  openedAt: Date.now(),
  repoCount: 1,
  logoUrl: null,
  exists: true,
  open: false,
  ...over,
});

const draft: ProjectDraft = { dir: '/Users/me/studios/new', name: 'new', repoCount: 2, logos: [], links: [], taken: null };

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState(initial, true);
  useApp.setState({
    home: '/Users/me',
    workspace: { dir: null, repos: [], rootSessions: 0, refreshedAt: 0 },
    projects: [
      view('quizei', {
        repoCount: 8,
        links: [
          { url: 'https://quizei.com/', label: 'Site' },
          { url: 'https://admin.quizei.com/', label: 'Admin' },
          { url: 'https://apps.apple.com/app/quizei', label: 'App Store' },
        ],
      }),
      view('edi', { logo: { kind: 'image', file: 'edi-00000000.svg' }, logoUrl: 'edi-logo://logo/edi-00000000.svg', openedAt: Date.now() - 86_400_000 }),
      view('archive', { exists: false, openedAt: 0 }),
    ],
  });
  for (const fn of Object.values(bridge.edi)) if (vi.isMockFunction(fn)) fn.mockClear();
});
afterEach(cleanup);

const cards = () => screen.getAllByTestId('project-card');
const card = (name: string) => cards().find((element) => element.dataset.project === name)!;

describe('ProjectsScreen', () => {
  it('shows the projects last opened first, the first one marked Last opened', () => {
    render(<ProjectsScreen overlay={false} />);
    expect(cards().map((element) => element.dataset.project)).toEqual(['Quizei', 'Edi', 'Archive']);
    const quizei = within(card('Quizei'));
    expect(quizei.getByText('Last opened')).toBeTruthy();
    expect(quizei.getByText('~/studios/quizei')).toBeTruthy();
    expect(quizei.getByText('8 repos')).toBeTruthy();
    expect(quizei.getByText('quizei.com')).toBeTruthy();
    expect(quizei.getByText('+2')).toBeTruthy();
    expect(quizei.getByText('Today')).toBeTruthy();
    expect(within(card('Edi')).queryByText('Last opened')).toBeNull();
    expect(within(card('Edi')).getByText('Yesterday')).toBeTruthy();
    expect(within(card('Edi')).getByTestId('project-logo').getAttribute('src')).toBe('edi-logo://logo/edi-00000000.svg');
  });

  it('opens a project on a click', () => {
    render(<ProjectsScreen overlay={false} />);
    fireEvent.click(within(card('Edi')).getAllByRole('button')[0]!);
    expect(bridge.edi.openProject).toHaveBeenCalledWith('edi');
  });

  it('a project whose folder has moved can be located or removed', () => {
    render(<ProjectsScreen overlay={false} />);
    const archive = within(card('Archive'));
    expect(archive.getByText('Folder not found')).toBeTruthy();
    fireEvent.click(archive.getByRole('button', { name: 'Locate…' }));
    expect(bridge.edi.locateProject).toHaveBeenCalledWith('archive');
    fireEvent.click(archive.getByRole('button', { name: 'Remove from list' }));
    expect(bridge.edi.removeProject).toHaveBeenCalledWith('archive');
  });

  it('New project, from the button or the card, opens the sheet with what was found in the folder', async () => {
    bridge.edi.newProject.mockResolvedValueOnce(draft);
    render(<ProjectsScreen overlay={false} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New project' })));
    expect(useApp.getState().sheet).toMatchObject({ mode: 'new', projectId: null, draft });
    useApp.getState().closeSheet();
    await act(async () => fireEvent.click(screen.getByTestId('new-project-card')));
    expect(bridge.edi.newProject).toHaveBeenCalledTimes(2);
  });

  it('the card menu edits the project and opens its links', async () => {
    bridge.edi.projectDraft.mockResolvedValueOnce({ ...draft, dir: '/Users/me/studios/quizei' });
    bridge.edi.projectMenu.mockResolvedValueOnce('edit');
    render(<ProjectsScreen overlay={false} />);
    await act(async () => fireEvent.click(within(card('Quizei')).getByRole('button', { name: 'More for Quizei' })));
    expect(bridge.edi.projectMenu).toHaveBeenCalledWith('quizei');
    expect(useApp.getState().sheet).toMatchObject({ mode: 'edit', projectId: 'quizei' });

    useApp.getState().closeSheet();
    bridge.edi.projectMenu.mockResolvedValueOnce('link:1');
    await act(async () => fireEvent.contextMenu(within(card('Quizei')).getAllByRole('button')[0]!));
    expect(bridge.edi.openUrl).toHaveBeenCalledWith('https://admin.quizei.com/');
  });

  it('over the open project: Open on its card, a click on it and Esc go back', async () => {
    useApp.setState((state) => ({
      workspace: { ...state.workspace, dir: '/Users/me/studios/edi' },
      projects: state.projects.map((project) => ({ ...project, open: project.id === 'edi' })),
      projectsShown: true,
    }));
    render(<ProjectsScreen overlay />);
    expect(within(card('Edi')).getByText('Open')).toBeTruthy();
    expect(within(card('Quizei')).queryByText('Last opened')).toBeNull();
    expect(screen.getByText('back to Edi')).toBeTruthy();

    await act(async () => fireEvent.click(within(card('Edi')).getAllByRole('button')[0]!));
    expect(bridge.edi.openProject).not.toHaveBeenCalled();
    expect(useApp.getState().projectsShown).toBe(false);

    act(() => useApp.getState().showProjects(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useApp.getState().projectsShown).toBe(false);
  });

  it('moves between the cards with the arrows', () => {
    render(<ProjectsScreen overlay={false} />);
    const first = within(card('Quizei')).getAllByRole('button')[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(within(card('Edi')).getAllByRole('button')[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('new-project-card'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('says why a project could not be opened', async () => {
    bridge.edi.openProject.mockResolvedValueOnce({ ok: false, error: 'Folder not found' } as never);
    render(<ProjectsScreen overlay={false} />);
    await act(async () => fireEvent.click(within(card('Edi')).getAllByRole('button')[0]!));
    expect(screen.getByRole('alert').textContent).toContain('Edi: Folder not found');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
