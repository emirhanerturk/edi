// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoStatus } from '../../src/git/types';
import type { RepoView } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  listFiles: vi.fn(async (_repoPath: string) => ({ ok: true, files: ['a.ts'], ignored: ['dist/'], dirs: [] })),
  listDir: vi.fn(async (_repoPath: string, _dirPath: string) => ({ ok: true, entries: [{ name: 'app.js', dir: false }], more: 0 })),
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge }));

const { useApp } = await import('../../src/renderer/store');
const { FilesPanel } = await import('../../src/renderer/files/FilesPanel');

afterEach(cleanup);

const status = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  head: 'main',
  headOid: 'a'.repeat(40),
  detached: false,
  unborn: false,
  upstream: null,
  ahead: null,
  behind: null,
  files: [],
  ...over,
});
const repo = (path: string, over: Partial<RepoStatus> = {}): RepoView => ({
  name: path.split('/').pop()!,
  path,
  status: status(over),
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
});
const show = (dir: string, repos: RepoView[]) =>
  act(() => {
    useApp.setState((state) => ({ workspace: { ...state.workspace, dir, repos } }));
  });

describe('FilesPanel rereads the file list', () => {
  it('in a clean repo when the branch changes or HEAD moves (pull, commit)', async () => {
    show('/w/a', [repo('/w/a')]);
    render(<FilesPanel />);
    expect(bridge.listFiles).toHaveBeenCalledTimes(1);
    show('/w/a', [repo('/w/a', { head: 'other' })]);
    expect(bridge.listFiles).toHaveBeenCalledTimes(2);
    show('/w/a', [repo('/w/a', { head: 'other', headOid: 'b'.repeat(40) })]);
    expect(bridge.listFiles).toHaveBeenCalledTimes(3);
    show('/w/a', [repo('/w/a', { head: 'other', headOid: 'b'.repeat(40) })]);
    expect(bridge.listFiles).toHaveBeenCalledTimes(3);
  });

  it('does not reuse the old list after leaving for another folder and coming back', async () => {
    bridge.listFiles.mockClear();
    show('/w/a', [repo('/w/a')]);
    render(<FilesPanel />);
    expect(bridge.listFiles).toHaveBeenCalledTimes(1);
    show('/w/b', [repo('/w/b')]);
    show('/w/a', [repo('/w/a')]);
    expect(bridge.listFiles.mock.calls.map((call) => call[0])).toEqual(['/w/a', '/w/b', '/w/a']);
  });
});

describe('FilesPanel and ignored folders', () => {
  it('reads one when it opens and refreshes it when reopened; does not read an open folder outside one', async () => {
    bridge.listDir.mockClear();
    useApp.setState({ filesOpen: {} });
    show('/w/a', [repo('/w/a')]);
    render(<FilesPanel />);
    await act(async () => {});
    expect(bridge.listDir).not.toHaveBeenCalled();
    act(() => useApp.getState().toggleFilesDir('/w/a\nsrc', true));
    expect(bridge.listDir).not.toHaveBeenCalled();
    act(() => useApp.getState().toggleFilesDir('/w/a\ndist', true));
    await act(async () => {});
    expect(bridge.listDir.mock.calls).toEqual([['/w/a', 'dist']]);
    act(() => useApp.getState().toggleFilesDir('/w/a\ndist', false));
    act(() => useApp.getState().toggleFilesDir('/w/a\ndist', true));
    await act(async () => {});
    expect(bridge.listDir).toHaveBeenCalledTimes(2);
  });
});
