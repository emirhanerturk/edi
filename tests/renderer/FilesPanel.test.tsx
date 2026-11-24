// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChange, FileList, RepoStatus } from '../../src/git/types';
import { FilesPanelView, type FilesPanelViewProps } from '../../src/renderer/files/FilesPanel';
import type { RepoView } from '../../src/shared/api';

afterEach(cleanup);

const status = (files: FileChange[] = []): RepoStatus => ({
  head: 'main',
  headOid: 'a'.repeat(40),
  detached: false,
  unborn: false,
  upstream: null,
  ahead: null,
  behind: null,
  files,
});
const repo = (name: string, files: FileChange[] = []): RepoView => ({
  name,
  path: `/w/${name}`,
  status: status(files),
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
});
const appRepo = repo('quizei-app', [{ path: 'app/play.tsx', origPath: null, x: '.', y: 'M', kind: 'changed' }]);
const apiRepo = repo('quizei-api');
const lists: Record<string, FileList> = {
  '/w/quizei-app': { ok: true, files: ['app/play.tsx', 'app/result.tsx', 'package.json'], ignored: ['.env', 'node_modules/'] },
};

function renderView(over: Partial<FilesPanelViewProps> = {}) {
  const props: FilesPanelViewProps = {
    repos: [appRepo, apiRepo],
    single: false,
    lists,
    dirs: {},
    open: {},
    selected: null,
    onToggle: vi.fn(),
    onOpenFile: vi.fn(),
    ...over,
  };
  render(<FilesPanelView {...props} />);
  return props;
}
const rows = () => screen.getAllByTestId('tree-row');
const brief = () => rows().map((row) => `${'-'.repeat(Number(row.dataset.depth))}${row.dataset.name}${row.dataset.badge ? ` ${row.dataset.badge}` : ''}`);

describe('FilesPanelView', () => {
  it('each repo is a collapsed top-level folder; a repo with changes is marked', () => {
    renderView();
    expect(brief()).toEqual(['quizei-app ●', 'quizei-api']);
    expect(rows().map((row) => row.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
  });

  it('open repos and folders show their contents; changed files show their letter', () => {
    renderView({ open: { '/w/quizei-app\n': true, '/w/quizei-app\napp': true } });
    expect(brief()).toEqual(['quizei-app ●', '-app ●', '--play.tsx M', '--result.tsx', '-node_modules', '-.env', '-package.json', 'quizei-api']);
  });

  it('says when the file list is loading, and shows the error when it cannot be read', () => {
    renderView({ open: { '/w/quizei-api\n': true } });
    expect(screen.getByText('Loading…')).toBeTruthy();
    cleanup();
    renderView({ open: { '/w/quizei-api\n': true }, lists: { '/w/quizei-api': { ok: false, error: 'fatal: broken' } } });
    expect(screen.getByText('fatal: broken')).toBeTruthy();
  });

  it('when the open folder is a single repo, the tree starts directly with its contents', () => {
    renderView({ repos: [appRepo], single: true });
    expect(brief()).toEqual(['app ●', 'node_modules', '.env', 'package.json']);
  });

  it('clicking a folder expands or collapses it', () => {
    const { onToggle } = renderView({ open: { '/w/quizei-app\n': true } });
    fireEvent.click(rows()[0]!);
    expect(onToggle).toHaveBeenLastCalledWith('/w/quizei-app\n', false);
    fireEvent.click(rows()[1]!);
    expect(onToggle).toHaveBeenLastCalledWith('/w/quizei-app\napp', true);
  });

  it('a single click on a file opens a preview, a double-click a pinned tab', () => {
    const { onOpenFile } = renderView({ open: { '/w/quizei-app\n': true } });
    const file = rows().find((row) => row.dataset.name === 'package.json')!;
    fireEvent.click(file);
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', 'package.json', false);
    fireEvent.doubleClick(file);
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', 'package.json', true);
  });

  it('the file open in the center panel shows as selected', () => {
    renderView({ open: { '/w/quizei-app\n': true, '/w/quizei-app\napp': true }, selected: { repoPath: '/w/quizei-app', path: 'app/play.tsx' } });
    expect(rows().filter((row) => row.getAttribute('aria-current') === 'true').map((row) => row.dataset.name)).toEqual(['play.tsx']);
  });

  it('ignored files and folders look faded; the file opens, the folder expands and collapses', () => {
    const props = renderView({ open: { '/w/quizei-app\n': true } });
    const row = (name: string) => rows().find((r) => r.dataset.name === name)!;
    expect(row('.env').dataset.ignored).toBe('true');
    expect(row('node_modules').dataset.ignored).toBe('true');
    expect(row('package.json').dataset.ignored).toBeUndefined();
    expect(row('node_modules').getAttribute('aria-expanded')).toBe('false');
    expect(row('node_modules').title).toBe('node_modules (ignored by git)');
    fireEvent.click(row('node_modules'));
    expect(props.onToggle).toHaveBeenCalledWith('/w/quizei-app\nnode_modules', true);
    fireEvent.click(row('.env'));
    expect(props.onOpenFile).toHaveBeenCalledWith('/w/quizei-app', '.env', false);
  });

  it('an open ignored folder says when it is loading, then shows its contents faded and counts the rest', () => {
    const open = { '/w/quizei-app\n': true, '/w/quizei-app\nnode_modules': true };
    renderView({ open });
    expect(screen.getByText('Loading…')).toBeTruthy();
    cleanup();
    renderView({ open, dirs: { '/w/quizei-app\nnode_modules': { ok: false, error: 'Folder not found' } } });
    expect(screen.getByText('Folder not found')).toBeTruthy();
    cleanup();
    renderView({
      open,
      dirs: {
        '/w/quizei-app\nnode_modules': {
          ok: true,
          entries: [
            { name: 'react', dir: true },
            { name: '.yarn-integrity', dir: false },
          ],
          more: 1200,
        },
      },
    });
    expect(brief().slice(0, 5)).toEqual(['quizei-app ●', '-app ●', '-node_modules', '--react', '--.yarn-integrity']);
    expect(rows().find((r) => r.dataset.name === 'react')!.dataset.ignored).toBe('true');
    const more = screen.getByText('1,200 more not shown');
    const last = rows().find((r) => r.dataset.name === '.yarn-integrity')!;
    const next = rows().find((r) => r.dataset.name === 'package.json')!;
    // The note comes after the folder's last row and before the next sibling.
    expect(last.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(more.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('in a multi-repo view each repo is its own section, as on the Git tab; the open one is highlighted', () => {
    renderView({ open: { '/w/quizei-app\n': true } });
    const groups = screen.getAllByTestId('files-repo');
    expect(groups.map((group) => [group.dataset.repo, group.classList.contains('open')])).toEqual([
      ['quizei-app', true],
      ['quizei-api', false],
    ]);
  });

  it('says so when there are no repos', () => {
    renderView({ repos: [] });
    expect(screen.getByText('No git repositories in this folder')).toBeTruthy();
  });
});
