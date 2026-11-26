// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChosenLogo, OpenResult, ProjectDraft, ProjectView } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    createProject: vi.fn(async (): Promise<OpenResult> => ({ ok: true })),
    updateProject: vi.fn(async (): Promise<OpenResult> => ({ ok: true })),
    removeProject: vi.fn(async (): Promise<OpenResult> => ({ ok: true })),
    chooseProjectFolder: vi.fn(async (): Promise<ProjectDraft | null> => null),
    chooseLogo: vi.fn(async (): Promise<ChosenLogo> => null),
    confirmDiscard: vi.fn(async (): Promise<boolean> => true),
    setUnsaved: vi.fn(),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp } = await import('../../src/renderer/store');
const { ProjectSheet } = await import('../../src/renderer/projects/ProjectSheet');

const draft: ProjectDraft = {
  dir: '/Users/me/studios/edi',
  name: 'edi',
  repoCount: 1,
  repoNames: [],
  logos: [
    { id: 'w', path: 'docs/design/icon/wordmark.svg', url: 'edi-logo://found/w' },
    { id: 'i', path: 'build/icon-1024.png', url: 'edi-logo://found/i' },
  ],
  links: [{ url: 'https://github.com/emirhanerturk/edi', label: 'GitHub' }],
  taken: null,
};

const project: ProjectView = {
  id: 'quizei',
  dir: '/Users/me/studios/quizei',
  name: 'Quizei',
  logo: { kind: 'image', file: 'quizei-00000000.png' },
  links: [
    { url: 'https://quizei.com/', label: 'Site' },
    { url: 'https://admin.quizei.com/', label: 'Admin' },
  ],
  openedAt: 1,
  repoCount: 8,
  repos: { order: [], ignored: [] },
  logoUrl: 'edi-logo://logo/quizei-00000000.png',
  exists: true,
  open: false,
};

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState(initial, true);
  useApp.setState({ home: '/Users/me', projects: [project] });
  for (const fn of Object.values(bridge.edi)) if (vi.isMockFunction(fn)) fn.mockClear();
});
afterEach(cleanup);

const openNew = (over: Partial<ProjectDraft> = {}) => {
  const sheet = { mode: 'new' as const, projectId: null, draft: { ...draft, ...over }, serial: 1 };
  useApp.setState({ sheet });
  return render(<ProjectSheet sheet={sheet} />);
};
const openEdit = (over: Partial<ProjectView> = {}, draftOver: Partial<ProjectDraft> = {}) => {
  useApp.setState({ projects: [{ ...project, ...over }] });
  const sheet = { mode: 'edit' as const, projectId: 'quizei', draft: { ...draft, dir: project.dir, logos: [], links: [], ...draftOver }, serial: 2 };
  useApp.setState({ sheet });
  return render(<ProjectSheet sheet={sheet} />);
};
const pressed = () => screen.getAllByRole('button', { pressed: true }).map((button) => button.getAttribute('aria-label'));
const submit = async () => act(async () => fireEvent.submit(screen.getByRole('dialog')));

describe('ProjectSheet, new', () => {
  it('starts with the folder, its name, the first image found and the repository page', () => {
    openNew();
    expect(screen.getByRole('heading', { name: 'New project' })).toBeTruthy();
    expect(screen.getByTestId('sheet-folder').textContent).toBe('~/studios/edi');
    expect(screen.getByText('1 git repository found')).toBeTruthy();
    expect((screen.getByLabelText('NAME') as HTMLInputElement).value).toBe('edi');
    expect(document.activeElement).toBe(screen.getByLabelText('NAME'));
    expect(pressed()).toEqual(['docs/design/icon/wordmark.svg', 'Main link']);
    expect(screen.getByTestId('logo-caption').textContent).toBe('Found in the folder: docs/design/icon/wordmark.svg');
    expect((screen.getByLabelText('Link 1 address') as HTMLInputElement).value).toBe('https://github.com/emirhanerturk/edi');
    expect((screen.getByLabelText('Link 1 label') as HTMLInputElement).value).toBe('GitHub');
  });

  it('creates the project with the image picked, the name typed and the starred link first', async () => {
    openNew();
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: ' edi app ' } });
    fireEvent.click(screen.getByRole('button', { name: 'build/icon-1024.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Link 2 address'));
    fireEvent.change(screen.getByLabelText('Link 2 address'), { target: { value: 'github.com/emirhanerturk/edi/pulls' } });
    fireEvent.change(screen.getByLabelText('Link 2 label'), { target: { value: 'Pull requests' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make link 2 the main link' }));
    await submit();
    expect(bridge.edi.createProject).toHaveBeenCalledWith({
      dir: '/Users/me/studios/edi',
      name: 'edi app',
      logo: { kind: 'candidate', id: 'i' },
      links: [
        { url: 'https://github.com/emirhanerturk/edi/pulls', label: 'Pull requests' },
        { url: 'https://github.com/emirhanerturk/edi', label: 'GitHub' },
      ],
      repos: { order: [], ignored: [] },
    });
    expect(useApp.getState().sheet).toBeNull();
  });

  it('the letter takes a color; an empty link row is left out', async () => {
    openNew({ links: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Letter' }));
    expect(screen.getByTestId('logo-caption').textContent).toBe('The first letter of the name, on the color picked.');
    fireEvent.click(screen.getByRole('button', { name: 'Orange' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    await submit();
    expect(bridge.edi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ logo: { kind: 'letter', color: 'orange' }, links: [] }),
    );
  });

  it('a link that is not a web address stops it, and so does a missing name', async () => {
    openNew();
    fireEvent.change(screen.getByLabelText('Link 1 address'), { target: { value: 'javascript:alert(1)' } });
    expect(screen.getByLabelText('Link 1 address').getAttribute('aria-invalid')).toBe('true');
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('Not a web address: javascript:alert(1)');
    expect(bridge.edi.createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 1' }));
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a folder that already is a project says so and cannot be made again', () => {
    openNew({ taken: { id: 'quizei', name: 'Quizei' } });
    expect(screen.getByText('This folder is already the project Quizei.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('another folder brings its own name and images, unless the name was typed', async () => {
    bridge.edi.chooseProjectFolder.mockResolvedValueOnce({ ...draft, dir: '/Users/me/studios/beremo', name: 'beremo', logos: [], links: [] });
    openNew();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change…' })));
    expect(bridge.edi.chooseProjectFolder).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('sheet-folder').textContent).toBe('~/studios/beremo');
    expect((screen.getByLabelText('NAME') as HTMLInputElement).value).toBe('beremo');
    // The new folder has no image: the letter, with its color.
    expect(pressed()).toEqual(['Letter', expect.any(String)]);
    expect(screen.queryByLabelText('Link 1 address')).toBeNull();
  });

  it('Choose… adds the image picked, or says why it cannot be used', async () => {
    bridge.edi.chooseLogo.mockResolvedValueOnce({ ok: true, logo: { id: 'c', path: 'brand.png', url: 'edi-logo://found/c' } });
    openNew();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose an image' })));
    expect(pressed()[0]).toBe('brand.png');
    expect(screen.getByTestId('logo-caption').textContent).toBe('Chosen: brand.png');
    bridge.edi.chooseLogo.mockResolvedValueOnce({ ok: false, error: 'The image is larger than 2 MB' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose an image' })));
    expect(screen.getByRole('alert').textContent).toBe('The image is larger than 2 MB');
  });

  it('Esc and Cancel close it without making anything', () => {
    openNew();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useApp.getState().sheet).toBeNull();
    expect(bridge.edi.createProject).not.toHaveBeenCalled();
  });

  it('shows why the project could not be made', async () => {
    bridge.edi.createProject.mockResolvedValueOnce({ ok: false, error: 'Folder not found' });
    openNew();
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('Folder not found');
    expect(useApp.getState().sheet).not.toBeNull();
  });
});

describe('ProjectSheet, edit', () => {
  it('starts from the project: its name, its image kept, its links with the first one starred', async () => {
    openEdit();
    expect(screen.getByRole('heading', { name: 'Edit project' })).toBeTruthy();
    expect((screen.getByLabelText('NAME') as HTMLInputElement).value).toBe('Quizei');
    expect(pressed()).toEqual(['The current logo', 'Main link']);
    expect((screen.getByLabelText('Link 2 label') as HTMLInputElement).value).toBe('Admin');
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: 'Quizei Web' } });
    await submit();
    expect(bridge.edi.updateProject).toHaveBeenCalledWith('quizei', {
      dir: '/Users/me/studios/quizei',
      name: 'Quizei Web',
      logo: { kind: 'keep' },
      links: project.links,
      repos: project.repos,
    });
    expect(useApp.getState().sheet).toBeNull();
  });

  it('the open project keeps its folder: no Change…', () => {
    openEdit({ open: true });
    expect(screen.queryByRole('button', { name: 'Change…' })).toBeNull();
  });

  it('Remove from list closes the sheet once the project is gone', async () => {
    openEdit();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove from list' })));
    expect(bridge.edi.removeProject).toHaveBeenCalledWith('quizei');
    expect(useApp.getState().sheet).toBeNull();
  });
});

describe('ProjectSheet, repositories', () => {
  const four = ['next-quiz', 'quizei-admin', 'quizei-api', 'quizei-frontend'];
  const rows = () => screen.getAllByTestId('sheet-repo-row').map((row) => row.textContent);
  const keep = (name: string) => screen.getByRole('checkbox', { name: `Keep ${name}` }) as HTMLInputElement;
  const folderNote = () => screen.getByTestId('sheet-folder').closest('.sheet-field')!.querySelector('.sheet-note')!.textContent;

  it('lists the repos before the links, in the project order with the ignored ones unticked', () => {
    openEdit({ repos: { order: ['quizei-frontend'], ignored: ['next-quiz'] } }, { repoCount: 4, repoNames: four });
    const labels = [...document.querySelectorAll('.sheet-label')].map((el) => el.textContent ?? '');
    expect(labels.indexOf('REPOSITORIES')).toBeGreaterThan(-1);
    expect(labels.indexOf('REPOSITORIES')).toBeLessThan(labels.findIndex((text) => text.startsWith('LINKS')));
    expect(rows()).toEqual(['quizei-frontend', 'next-quizignored', 'quizei-admin', 'quizei-api']);
    expect(keep('next-quiz').checked).toBe(false);
    expect(keep('quizei-frontend').checked).toBe(true);
    expect(folderNote()).toBe('4 git repositories found · 1 ignored');
  });

  it('⌥↑ and ⌥↓ move a repo; unticking ignores it; Save sends the order and the ignored ones', async () => {
    openEdit({}, { repoCount: 4, repoNames: four });
    for (let i = 0; i < 3; i++) fireEvent.keyDown(keep('quizei-frontend'), { key: 'ArrowUp', altKey: true });
    expect(document.activeElement).toBe(keep('quizei-frontend'));
    fireEvent.keyDown(keep('quizei-admin'), { key: 'ArrowDown', altKey: true });
    // Without ⌥ the arrows do nothing here.
    fireEvent.keyDown(keep('next-quiz'), { key: 'ArrowUp' });
    expect(rows()).toEqual(['quizei-frontend', 'next-quiz', 'quizei-api', 'quizei-admin']);
    fireEvent.click(keep('next-quiz'));
    expect(rows()[1]).toBe('next-quizignored');
    await submit();
    expect(bridge.edi.updateProject).toHaveBeenCalledWith(
      'quizei',
      expect.objectContaining({ repos: { order: ['quizei-frontend', 'next-quiz', 'quizei-api', 'quizei-admin'], ignored: ['next-quiz'] } }),
    );
  });

  it('dragging a repo by its handle drops it where it is let go', () => {
    openEdit({}, { repoCount: 4, repoNames: four });
    const [first] = screen.getAllByTestId('sheet-repo-row');
    fireEvent.dragStart(screen.getByRole('button', { name: 'Move quizei-frontend' }));
    fireEvent.dragOver(first!);
    fireEvent.drop(first!);
    expect(rows()).toEqual(['quizei-frontend', 'next-quiz', 'quizei-admin', 'quizei-api']);
  });

  it('every repo can be ignored, and ticked back', () => {
    openEdit({}, { repoCount: 4, repoNames: four });
    for (const name of four) fireEvent.click(keep(name));
    expect(rows()).toHaveLength(4);
    expect(folderNote()).toBe('4 git repositories found · 4 ignored');
    fireEvent.click(keep('quizei-api'));
    expect(folderNote()).toBe('4 git repositories found · 3 ignored');
  });

  it('no section for a folder that is itself a repo; another folder starts with all of its repos kept', async () => {
    openNew({ repoNames: [] });
    expect(screen.queryByText('REPOSITORIES')).toBeNull();
    cleanup();

    bridge.edi.chooseProjectFolder.mockResolvedValueOnce({ ...draft, dir: '/Users/me/studios/beremo', name: 'beremo', repoCount: 2, repoNames: ['web', 'api'] });
    openNew({ repoCount: 4, repoNames: four });
    fireEvent.click(keep('next-quiz'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change…' })));
    expect(rows()).toEqual(['api', 'web']);
    expect(keep('web').checked).toBe(true);
    await submit();
    expect(bridge.edi.createProject).toHaveBeenCalledWith(expect.objectContaining({ repos: { order: ['api', 'web'], ignored: [] } }));
  });

  it('a repo that is ignored stays listed even when it is the only one left, so it can be ticked back', () => {
    openEdit({ repos: { order: [], ignored: ['web'] } }, { repoCount: 1, repoNames: ['web'] });
    expect(rows()).toEqual(['webignored']);
    fireEvent.click(keep('web'));
    expect(keep('web').checked).toBe(true);
  });

  describe('unsaved edits in a repo about to be ignored', () => {
    const quizPath = `${project.dir}/next-quiz`;
    function withUnsavedTab() {
      useApp.setState({
        workspace: { ...useApp.getState().workspace, dir: project.dir, repos: four.map((name) => ({ name, path: `${project.dir}/${name}` }) as never) },
        center: { tabs: [{ id: 't1', kind: 'file', repoPath: quizPath, path: 'src/login.ts', pinned: true }], active: 't1' } as never,
        unsaved: { t1: true },
      });
    }

    it('asks before Save, and Cancel keeps the sheet open', async () => {
      openEdit({ open: true }, { repoCount: 4, repoNames: four });
      withUnsavedTab();
      bridge.edi.confirmDiscard.mockResolvedValueOnce(false);
      fireEvent.click(keep('next-quiz'));
      await submit();
      expect(bridge.edi.confirmDiscard).toHaveBeenCalledWith('login.ts');
      expect(bridge.edi.updateProject).not.toHaveBeenCalled();
      expect(useApp.getState().sheet).not.toBeNull();
    });

    it('saves once the edits are given up; nothing is asked for a repo that stays', async () => {
      openEdit({ open: true }, { repoCount: 4, repoNames: four });
      withUnsavedTab();
      fireEvent.click(keep('quizei-admin'));
      await submit();
      expect(bridge.edi.confirmDiscard).not.toHaveBeenCalled();
      expect(bridge.edi.updateProject).toHaveBeenCalledTimes(1);
    });
  });
});
