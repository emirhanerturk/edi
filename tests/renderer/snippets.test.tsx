// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectView, Snippet, SnippetInput, SnippetMenuAction, SnippetResult } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  edi: {
    on: () => () => undefined,
    setUnsaved: vi.fn(),
    saveSnippet: vi.fn<(input: SnippetInput) => Promise<SnippetResult>>(),
    snippetMenu: vi.fn<() => Promise<SnippetMenuAction | null>>(),
    duplicateSnippet: vi.fn<(id: string) => Promise<SnippetResult>>(),
    deleteSnippet: vi.fn<(id: string) => Promise<SnippetResult>>(),
  },
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));
vi.mock('../../src/renderer/terminals/terminals', () => ({}));

const { useApp, applyTabStates } = await import('../../src/renderer/store');
const { SnippetsMenu, commandPreview, groupSnippets } = await import('../../src/renderer/snippets/SnippetsMenu');
const { SnippetSheet } = await import('../../src/renderer/snippets/SnippetSheet');

afterEach(cleanup);

const snippet = (over: Partial<Snippet>): Snippet => ({ id: 's', name: 'Snippet', group: '', where: '', command: 'echo hi', ask: false, ...over });
const SNIPPETS = [
  snippet({ id: 'install', name: 'Install everything', command: 'for repo in quizei-*; do\n  (cd "$repo" && npm install)\ndone' }),
  snippet({ id: 'api', name: 'Backend: dev server', group: 'Dev', where: 'quizei-backend', command: 'npm run dev' }),
  snippet({ id: 'seed', name: 'Seed test data', group: 'Database', where: 'quizei-backend', command: 'npm run db:reset -- --force\nnpm run db:seed' }),
  snippet({ id: 'deploy', name: 'Deploy marketing site', group: 'Release', where: 'quizei-marketing', command: 'npm run deploy', ask: true }),
];
const project = (snippets: Snippet[]): ProjectView => ({
  id: 'p',
  dir: '/s/quizei',
  name: 'Quizei',
  logo: { kind: 'letter', color: 'purple' },
  links: [],
  openedAt: 1,
  repoCount: 2,
  repos: { order: [], ignored: [] },
  snippets,
  logoUrl: null,
  exists: true,
  open: true,
});

const runSnippet = vi.fn();
const typeSnippet = vi.fn();

beforeEach(() => {
  for (const fn of Object.values(bridge.edi)) if (vi.isMockFunction(fn)) fn.mockReset();
  runSnippet.mockReset();
  typeSnippet.mockReset();
  useApp.setState({
    projects: [project(SNIPPETS)],
    home: '/Users/me',
    workspace: {
      dir: '/s/quizei',
      repos: ['quizei-backend', 'quizei-marketing'].map((name) => ({ name, path: `/s/quizei/${name}`, status: null, error: null, busy: null, claude: 0, hasRemote: false })),
      ignored: 0,
      rootSessions: 0,
      refreshedAt: 1,
    },
    snippetSheet: null,
    runSnippet,
    typeSnippet,
  });
});

describe('groupSnippets and commandPreview', () => {
  it('lists the snippets without a group first, then the groups as they were made; filters on name, command and place', () => {
    expect(groupSnippets([SNIPPETS[1]!, ...SNIPPETS], '').map((g) => [g.group, g.snippets.map((s) => s.id)])).toEqual([
      ['', ['install']],
      ['Dev', ['api', 'api']],
      ['Database', ['seed']],
      ['Release', ['deploy']],
    ]);
    expect(groupSnippets(SNIPPETS, 'backend').flatMap((g) => g.snippets.map((s) => s.id))).toEqual(['api', 'seed']);
    expect(commandPreview('npm run db:reset -- --force\nnpm run db:seed')).toBe('npm run db:reset -- --force   +1 line');
  });
});

describe('SnippetsMenu', () => {
  const openMenu = () => fireEvent.click(screen.getByTestId('snippets-button'));

  it('runs a snippet on click and types it on ⌥-click', () => {
    render(<SnippetsMenu />);
    openMenu();
    expect(screen.getAllByTestId('snippet-row').map((row) => row.querySelector('.snippet-name')!.textContent)).toEqual([
      'Install everything',
      'Backend: dev server',
      'Seed test data',
      'Deploy marketing site',
    ]);
    expect(screen.getByText('· asks first')).toBeTruthy();
    expect(screen.getByText('DATABASE')).toBeTruthy();
    fireEvent.click(screen.getByText('Backend: dev server'));
    expect(runSnippet).toHaveBeenCalledWith(SNIPPETS[1]);
    expect(screen.queryByTestId('snippets-menu')).toBeNull();
    openMenu();
    fireEvent.click(screen.getByText('Seed test data'), { altKey: true });
    expect(typeSnippet).toHaveBeenCalledWith(SNIPPETS[2]);
  });

  it('filters, and says when nothing matches', () => {
    render(<SnippetsMenu />);
    openMenu();
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter snippets' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No snippet matches “zzz”.')).toBeTruthy();
  });

  it('offers New snippet…, and explains itself when there are none', () => {
    useApp.setState({ projects: [project([])] });
    render(<SnippetsMenu />);
    openMenu();
    expect(screen.getByText('Save a command you run often, then run it from here with a click.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('new-snippet'));
    expect(useApp.getState().snippetSheet).toEqual({ snippet: null, serial: expect.any(Number) });
  });

  it('a right-click menu edits, duplicates or deletes', async () => {
    bridge.edi.snippetMenu.mockResolvedValue('duplicate');
    bridge.edi.duplicateSnippet.mockResolvedValue({ ok: true, id: 'copy' });
    render(<SnippetsMenu />);
    openMenu();
    fireEvent.contextMenu(screen.getByText('Install everything'));
    await waitFor(() => expect(bridge.edi.duplicateSnippet).toHaveBeenCalledWith('install'));
  });
});

describe('SnippetSheet', () => {
  it('saves a new snippet with its group, place, command and question', async () => {
    bridge.edi.saveSnippet.mockResolvedValue({ ok: true, id: 'new' });
    useApp.setState({ snippetSheet: { snippet: null, serial: 1 } });
    render(<SnippetSheet snippet={null} />);
    expect(screen.getByText('Saved with the Quizei project, not in a repository.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: 'Migrate' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Database' }));
    fireEvent.click(screen.getByRole('button', { name: 'Runs in Project folder' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /quizei-backend/ }));
    fireEvent.change(screen.getByLabelText('COMMAND'), { target: { value: 'npx prisma migrate dev' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));
    await waitFor(() => expect(useApp.getState().snippetSheet).toBeNull());
    expect(bridge.edi.saveSnippet).toHaveBeenCalledWith({ name: 'Migrate', group: 'Database', where: 'quizei-backend', command: 'npx prisma migrate dev', ask: true });
  });

  it('edits a snippet in place, with a new group, and shows why a save was refused', async () => {
    bridge.edi.saveSnippet.mockResolvedValue({ ok: false, error: 'That repository is not in the project' });
    render(<SnippetSheet snippet={SNIPPETS[1]!} />);
    expect(screen.getByRole('heading').textContent).toBe('Edit snippet');
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    const field = screen.getByRole('textbox', { name: 'New group name' });
    fireEvent.change(field, { target: { value: 'Servers' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('radio', { name: 'Servers' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'That repository is not in the project');
    expect(bridge.edi.saveSnippet).toHaveBeenCalledWith(expect.objectContaining({ id: 'api', group: 'Servers', where: 'quizei-backend' }));
  });
});

describe('a snippet tab', () => {
  it('keeps the snippet name whatever runs in it', () => {
    const tab = { id: 1, title: 'Backend: dev server', claude: false, waiting: false, busy: false, exited: false, claudeUntil: 0, titleState: null, snippet: true };
    expect(applyTabStates([tab], [{ id: 1, title: 'node', claude: false, busy: true }], 0)[0]).toMatchObject({ title: 'Backend: dev server', busy: true });
  });
});
