// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoStatus } from '../../src/git/types';
import type { RepoView } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({ listFiles: vi.fn(async (_repoPath: string) => ({ ok: true, files: ['a.ts'] })) }));
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

describe('FilesPanel dosya listesini yeniden okur', () => {
  it("temiz bir repoda branch değişince ya da HEAD ilerleyince (pull, commit)", async () => {
    show('/w/a', [repo('/w/a')]);
    render(<FilesPanel />);
    expect(bridge.listFiles).toHaveBeenCalledTimes(1);
    show('/w/a', [repo('/w/a', { head: 'baska' })]);
    expect(bridge.listFiles).toHaveBeenCalledTimes(2);
    show('/w/a', [repo('/w/a', { head: 'baska', headOid: 'b'.repeat(40) })]);
    expect(bridge.listFiles).toHaveBeenCalledTimes(3);
    show('/w/a', [repo('/w/a', { head: 'baska', headOid: 'b'.repeat(40) })]);
    expect(bridge.listFiles).toHaveBeenCalledTimes(3);
  });

  it('başka klasöre gidip dönünce eski liste kullanılmaz', async () => {
    bridge.listFiles.mockClear();
    show('/w/a', [repo('/w/a')]);
    render(<FilesPanel />);
    expect(bridge.listFiles).toHaveBeenCalledTimes(1);
    show('/w/b', [repo('/w/b')]);
    show('/w/a', [repo('/w/a')]);
    expect(bridge.listFiles.mock.calls.map((call) => call[0])).toEqual(['/w/a', '/w/b', '/w/a']);
  });
});
