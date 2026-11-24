// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChange, RepoStatus } from '../../src/git/types';
import { GitPanelView } from '../../src/renderer/git/GitPanelView';
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
  it('her reponun adını, branch\'ini ve eşitleme düğmesini gösterir', () => {
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

  it('değişikliği olan repo açık gelir, dosyaları gruplarında listelenir', () => {
    renderPanel();
    const app = row('quizei-app');
    expect(app.getAttribute('aria-expanded')).toBe('true');
    expect(row('quizei-api').getAttribute('aria-expanded')).toBe('false');

    const files = screen.getAllByTestId('file-row');
    // Staged: play.tsx. Changes: play.tsx (kısmen), old.ts (silinmiş), new.ts.
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

  it('rozet tekil değişen dosya sayısıdır', () => {
    renderPanel();
    expect(screen.getByTestId('git-badge').textContent).toBe('3');
  });

  it('okunamayan repo hatasını gösterir', () => {
    renderPanel();
    expect(within(row('broken')).getByText('fatal: not a git repository')).toBeTruthy();
  });

  it('kullanıcının açıp kapatma tercihi varsayılanı ezer', () => {
    const { onToggle } = renderPanel({ '/w/quizei-app': false, '/w/quizei-api': true });
    expect(row('quizei-app').getAttribute('aria-expanded')).toBe('false');
    expect(row('quizei-api').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryAllByTestId('file-row')).toHaveLength(0);
    expect(within(row('quizei-api')).getByText('No changes')).toBeTruthy();

    fireEvent.click(within(row('quizei-web')).getByTestId('repo-toggle'));
    expect(onToggle).toHaveBeenCalledWith('/w/quizei-web', true);
  });

  it('repo yoksa bunu söyler', () => {
    render(<GitPanelView repos={[]} expanded={{}} onToggle={() => undefined} />);
    expect(screen.getByText('No git repositories in this folder')).toBeTruthy();
    expect(screen.queryByTestId('git-badge')).toBeNull();
  });

  it('çakışma varken "Unstage all" kapalıdır: index sıfırlanırsa çakışma kaydı da silinirdi', () => {
    const merging = repo('merging', {
      status: status({ files: [file('README.md', 'U', 'U', 'conflicted'), file('temiz.txt', 'A', '.')] }),
    });
    render(<GitPanelView repos={[merging]} expanded={{}} onToggle={() => undefined} />);
    const button = screen.getByTestId('unstage-all') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Resolve the conflicts first');
  });
});

describe('GitPanelView, dosya açma', () => {
  function renderOpen(selected: { repoPath: string; path: string } | null = null) {
    const onOpenFile = vi.fn();
    const onOp = vi.fn();
    render(<GitPanelView repos={repos} expanded={{}} onToggle={() => undefined} onOpenFile={onOpenFile} onOp={onOp} selected={selected} />);
    return { onOpenFile, onOp };
  }
  const fileRow = (group: string, path: string) =>
    screen.getAllByTestId('file-row').find((el) => el.getAttribute('data-group') === group && el.getAttribute('data-path') === path)!;

  it('tek tık dosyayı önizleme olarak, çift tık kalıcı olarak açar', () => {
    const { onOpenFile } = renderOpen();
    fireEvent.click(fileRow('changes', 'lib/old.ts'));
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', expect.objectContaining({ path: 'lib/old.ts' }), false);
    fireEvent.doubleClick(fileRow('changes', 'new.ts'));
    expect(onOpenFile).toHaveBeenLastCalledWith('/w/quizei-app', expect.objectContaining({ path: 'new.ts', kind: 'untracked' }), true);
  });

  it('Enter tuşu da açar', () => {
    const { onOpenFile } = renderOpen();
    fireEvent.keyDown(fileRow('changes', 'lib/old.ts'), { key: 'Enter' });
    expect(onOpenFile).toHaveBeenCalledWith('/w/quizei-app', expect.objectContaining({ path: 'lib/old.ts' }), false);
  });

  it('stage düğmesi dosyayı açmaz', () => {
    const { onOpenFile, onOp } = renderOpen();
    const button = within(fileRow('changes', 'lib/old.ts')).getByTestId('stage-file');
    fireEvent.click(button);
    fireEvent.doubleClick(button);
    expect(onOp).toHaveBeenCalledTimes(1);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('orta panelde açık olan dosyanın satırı seçili görünür', () => {
    renderOpen({ repoPath: '/w/quizei-app', path: 'app/play.tsx' });
    const current = screen.getAllByTestId('file-row').filter((el) => el.getAttribute('aria-current') === 'true');
    // Kısmen stage'li dosya iki grupta da vardır.
    expect(current.map((el) => el.getAttribute('data-group'))).toEqual(['staged', 'changes']);
  });

  it('başka repodaki aynı yol seçili sayılmaz', () => {
    renderOpen({ repoPath: '/w/quizei-web', path: 'app/play.tsx' });
    expect(screen.getAllByTestId('file-row').filter((el) => el.getAttribute('aria-current') === 'true')).toHaveLength(0);
  });
});
