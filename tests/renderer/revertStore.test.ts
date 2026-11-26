import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitOp, OpResult, RepoView, WorkspaceView } from '../../src/shared/api';

const bridge = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    handlers,
    edi: {
      on: (channel: string, handler: (...args: unknown[]) => void) => {
        handlers[channel] = handler;
        return () => undefined;
      },
      getState: () => new Promise(() => undefined),
      claudeUsage: () => new Promise(() => undefined),
      setLayout: vi.fn(),
      setUnsaved: vi.fn(),
      git: vi.fn<(repoPath: string, op: GitOp) => Promise<OpResult>>(),
      confirmRevert: vi.fn<(subject: string) => Promise<boolean>>(),
      openUrl: vi.fn<(url: string) => Promise<OpResult>>(),
    },
  };
});
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp, connect } = await import('../../src/renderer/store');

const repo: RepoView = {
  name: 'app',
  path: '/w/app',
  status: { head: 'main', headOid: 'a'.repeat(40), detached: false, unborn: false, upstream: null, ahead: null, behind: null, stashes: 0, files: [] },
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
};
const commit = { oid: 'b'.repeat(40), subject: 'feat: b' };
const conflict = "This commit can't be reverted cleanly: it conflicts with later changes";

connect();
beforeEach(() => {
  bridge.edi.git.mockReset();
  bridge.edi.confirmRevert.mockReset();
  bridge.edi.openUrl.mockReset();
  bridge.handlers.workspace!({ ...useApp.getState().workspace, dir: '/w', repos: [repo] } satisfies WorkspaceView);
  useApp.setState({ errors: {}, retries: {}, expanded: {}, rightTab: 'history' });
});

describe('reverting a commit from the store', () => {
  it('cancel at the question runs nothing', async () => {
    bridge.edi.confirmRevert.mockResolvedValueOnce(false);
    await useApp.getState().revertCommit('/w/app', commit);
    expect(bridge.edi.confirmRevert).toHaveBeenCalledWith('feat: b');
    expect(bridge.edi.git).not.toHaveBeenCalled();
  });

  it('confirmed: runs revertCommit with the oid and stays on the tab it was started from', async () => {
    bridge.edi.confirmRevert.mockResolvedValueOnce(true);
    bridge.edi.git.mockResolvedValueOnce({ ok: true, message: 'Commit reverted' });
    await useApp.getState().revertCommit('/w/app', commit);
    expect(bridge.edi.git).toHaveBeenCalledWith('/w/app', { op: 'revertCommit', oid: commit.oid });
    expect(useApp.getState().rightTab).toBe('history');
    expect(useApp.getState().expanded).toEqual({});
  });

  it('a failed revert shows the Git tab with the repo expanded', async () => {
    bridge.edi.confirmRevert.mockResolvedValueOnce(true);
    bridge.edi.git.mockResolvedValueOnce({ ok: false, error: conflict });
    await useApp.getState().revertCommit('/w/app', commit);
    expect(useApp.getState().rightTab).toBe('git');
    expect(useApp.getState().expanded['/w/app']).toBe(true);
    expect(useApp.getState().errors['/w/app']).toBe(conflict);
  });
});

describe('commitAction', () => {
  it('copy writes the full oid; github opens the URL; revert asks', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await useApp.getState().commitAction('/w/app', commit, { action: 'copy' });
    expect(writeText).toHaveBeenCalledWith(commit.oid);

    bridge.edi.openUrl.mockResolvedValueOnce({ ok: true, message: '' });
    await useApp.getState().commitAction('/w/app', commit, { action: 'github', url: 'https://github.com/o/r/commit/b' });
    expect(bridge.edi.openUrl).toHaveBeenCalledWith('https://github.com/o/r/commit/b');

    bridge.edi.confirmRevert.mockResolvedValueOnce(false);
    await useApp.getState().commitAction('/w/app', commit, { action: 'revert' });
    expect(bridge.edi.confirmRevert).toHaveBeenCalledWith('feat: b');
    vi.unstubAllGlobals();
  });

  it('a clipboard that refuses is ignored', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    await expect(useApp.getState().commitAction('/w/app', commit, { action: 'copy' })).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
