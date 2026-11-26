// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PaletteRepo, QuickOpenView, paletteRows } from '../../src/renderer/quickOpen/QuickOpen';

vi.mock('../../src/renderer/bridge', () => ({ edi: {} }));

afterEach(cleanup);

const repos: PaletteRepo[] = [
  { path: '/w/app', name: 'quizei-app', branch: 'main', files: ['src/api/models.ts', 'src/screens/RankingScreen.tsx', 'src/store/modelCache.ts', 'README.md'] },
  { path: '/w/backend', name: 'quizei-backend', branch: 'main', files: ['src/models/user.model.ts', 'src/server.ts'] },
  { path: '/w/admin', name: 'quizei-admin', branch: 'feat/user-table', files: ['lib/models.ts', 'app/page.tsx'] },
];

const setup = (props: Partial<Parameters<typeof QuickOpenView>[0]> = {}) => {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(<QuickOpenView repos={repos} recent={[]} letters={new Map([['/w/app\nsrc/api/models.ts', 'M']])} onOpen={onOpen} onClose={onClose} {...props} />);
  const input = screen.getByTestId('quick-open-input');
  return { onOpen, onClose, input };
};

describe('paletteRows', () => {
  it('lists the recent files that still exist when nothing is typed', () => {
    const { rows, picks } = paletteRows('', repos, [
      { repoPath: '/w/backend', path: 'src/server.ts' },
      { repoPath: '/w/app', path: 'src/gone.ts' },
      { repoPath: '/w/elsewhere', path: 'x.ts' },
    ]);
    expect(rows[0]).toEqual({ kind: 'label', label: 'RECENTLY OPENED' });
    expect(picks).toEqual([{ repoPath: '/w/backend', path: 'src/server.ts', positions: [], hint: 'quizei-backend' }]);
  });

  it('groups the matches by repository, the best group first, and counts them', () => {
    const { rows, picks, total } = paletteRows('model', repos, []);
    expect(rows.filter((row) => row.kind === 'group').map((row) => row.kind === 'group' && row.name)).toEqual(['quizei-app', 'quizei-admin', 'quizei-backend']);
    expect(picks.map((pick) => pick.path)).toEqual(['src/api/models.ts', 'src/store/modelCache.ts', 'lib/models.ts', 'src/models/user.model.ts']);
    expect(total).toBe(4);
  });
});

describe('QuickOpenView', () => {
  it('opens the selected file with Enter, and keeps its tab with ⌘Enter', () => {
    const { onOpen, input } = setup();
    fireEvent.change(input, { target: { value: 'model' } });
    expect(screen.getAllByTestId('quick-open-group')).toHaveLength(3);
    expect(screen.getByTestId('quick-open-total').textContent).toBe('4 files in 3 repositories');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ repoPath: '/w/app', path: 'src/store/modelCache.ts' }), false);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'src/api/models.ts' }), true);
  });

  it('marks the matched letters and shows the status letter', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'model' } });
    const first = screen.getAllByTestId('quick-open-file')[0]!;
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect([...first.querySelectorAll('.hit')].map((hit) => hit.textContent)).toEqual(['model']);
    expect(first.querySelector('.quick-open-letter')!.textContent).toBe('M');
  });

  it('says when nothing matches, and Escape closes it', () => {
    const { onClose, input } = setup();
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByTestId('quick-open-none').textContent).toContain('No files match “zzzz”');
    expect(screen.getByTestId('quick-open-none').textContent).toContain('all 3 repositories');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('opens a clicked file, and the mouse moves the selection', () => {
    const { onOpen, input } = setup({ recent: [{ repoPath: '/w/admin', path: 'app/page.tsx' }, { repoPath: '/w/app', path: 'README.md' }] });
    expect(screen.getByText('RECENTLY OPENED')).toBeTruthy();
    const rows = screen.getAllByTestId('quick-open-file');
    fireEvent.mouseMove(rows[1]!);
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'README.md' }), false);
    fireEvent.click(rows[0]!, { metaKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'app/page.tsx' }), true);
  });
});
