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
  '/w/quizei-app': { ok: true, files: ['app/play.tsx', 'app/result.tsx', 'package.json'] },
};

function renderView(over: Partial<FilesPanelViewProps> = {}) {
  const props: FilesPanelViewProps = {
    repos: [appRepo, apiRepo],
    single: false,
    lists,
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
  it('her repo kapalı bir üst klasördür; değişiklik içeren repo işaretlidir', () => {
    renderView();
    expect(brief()).toEqual(['quizei-app ●', 'quizei-api']);
    expect(rows().map((row) => row.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
  });

  it('açık repo ve klasörlerin içi görünür; değişen dosya harfiyle', () => {
    renderView({ open: { '/w/quizei-app\n': true, '/w/quizei-app\napp': true } });
    expect(brief()).toEqual(['quizei-app ●', '-app ●', '--play.tsx M', '--result.tsx', '-package.json', 'quizei-api']);
  });

  it('dosya listesi yüklenirken bunu söyler; okunamadıysa hatayı', () => {
    renderView({ open: { '/w/quizei-api\n': true } });
    expect(screen.getByText('Loading…')).toBeTruthy();
    cleanup();
    renderView({ open: { '/w/quizei-api\n': true }, lists: { '/w/quizei-api': { ok: false, error: 'fatal: bozuk' } } });
    expect(screen.getByText('fatal: bozuk')).toBeTruthy();
  });

  it('açık klasör tek bir repoysa ağaç doğrudan onun içeriğiyle başlar', () => {
    renderView({ repos: [appRepo], single: true });
    expect(brief()).toEqual(['app ●', 'package.json']);
  });

  it('klasöre tıklamak açar ya da kapatır', () => {
    const { onToggle } = renderView({ open: { '/w/quizei-app\n': true } });
    fireEvent.click(rows()[0]!);
    expect(onToggle).toHaveBeenLastCalledWith('/w/quizei-app\n', false);
    fireEvent.click(rows()[1]!);
    expect(onToggle).toHaveBeenLastCalledWith('/w/quizei-app\napp', true);
  });

  it('dosyaya tek tık önizleme, çift tık kalıcı sekme açar', () => {
    const { onOpenFile } = renderView({ open: { '/w/quizei-app\n': true } });
    const file = rows().find((row) => row.dataset.name === 'package.json')!;
    fireEvent.click(file);
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', 'package.json', false);
    fireEvent.doubleClick(file);
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', 'package.json', true);
  });

  it('orta panelde açık olan dosya seçili görünür', () => {
    renderView({ open: { '/w/quizei-app\n': true, '/w/quizei-app\napp': true }, selected: { repoPath: '/w/quizei-app', path: 'app/play.tsx' } });
    expect(rows().filter((row) => row.getAttribute('aria-current') === 'true').map((row) => row.dataset.name)).toEqual(['play.tsx']);
  });

  it('repo yoksa bunu söyler', () => {
    renderView({ repos: [] });
    expect(screen.getByText('No git repositories in this folder')).toBeTruthy();
  });
});
