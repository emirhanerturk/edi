import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitOp, OpResult, RepoView, StashEntry, WorkspaceView } from '../../src/shared/api';

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
      confirmDropStash: vi.fn<(label: string) => Promise<boolean>>(),
    },
  };
});
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp, connect } = await import('../../src/renderer/store');

const repo: RepoView = {
  name: 'app',
  path: '/w/app',
  status: { head: 'main', headOid: 'a'.repeat(40), detached: false, unborn: false, upstream: null, ahead: null, behind: null, stashes: 1, files: [] },
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
};
const stash: StashEntry = {
  oid: 'c'.repeat(40),
  index: 0,
  subject: 'WIP on feat/x: 1a2b3c4 feat: x',
  message: null,
  branch: 'feat/x',
  baseSubject: 'feat: x',
  date: 1,
  untracked: false,
};
const refused = 'error: Your local changes to the following files would be overwritten by checkout:';

connect();
beforeEach(() => {
  bridge.edi.git.mockReset();
  bridge.edi.confirmDropStash.mockReset();
  bridge.handlers.workspace!({ ...useApp.getState().workspace, dir: '/w', repos: [repo] } satisfies WorkspaceView);
  useApp.setState({ errors: {}, retries: {} });
});

describe('stash actions in the store', () => {
  it('a switch refused because of local changes is kept for "Stash and switch"; the next operation clears it', async () => {
    bridge.edi.git.mockResolvedValueOnce({ ok: false, error: refused });
    await useApp.getState().gitOp('/w/app', { op: 'switch', branch: 'feat/x' });
    expect(useApp.getState().retries).toEqual({ '/w/app': { op: 'switch', branch: 'feat/x' } });
    expect(useApp.getState().errors['/w/app']).toBe(refused);

    bridge.edi.git.mockResolvedValueOnce({ ok: true, message: 'Switched to feat/x' });
    await useApp.getState().gitOp('/w/app', { op: 'stash', message: '', staged: false, then: { op: 'switch', branch: 'feat/x' } });
    expect(useApp.getState().retries).toEqual({});
    expect(useApp.getState().errors).toEqual({});
  });

  it('only a switch or a pull is retried, and dismissing the error forgets it', async () => {
    bridge.edi.git.mockResolvedValue({ ok: false, error: refused });
    await useApp.getState().gitOp('/w/app', { op: 'stash', message: '', staged: false, then: { op: 'pull' } });
    expect(useApp.getState().retries).toEqual({});
    await useApp.getState().gitOp('/w/app', { op: 'pull' });
    expect(useApp.getState().retries).toEqual({ '/w/app': { op: 'pull' } });
    useApp.getState().dismissError('/w/app');
    expect(useApp.getState().retries).toEqual({});
  });

  it("popping a stash closes its tab; applying keeps it", async () => {
    const target = { kind: 'stash' as const, repoPath: '/w/app', path: stash.oid, label: 'WIP on feat/x' };
    useApp.getState().openInCenter(target, true);
    bridge.edi.git.mockResolvedValue({ ok: true, message: 'Stash applied' });
    await useApp.getState().stashAction('/w/app', stash, 'apply');
    expect(bridge.edi.git).toHaveBeenLastCalledWith('/w/app', { op: 'stashApply', oid: stash.oid });
    expect(useApp.getState().center.tabs.map((tab) => tab.kind)).toEqual(['stash']);
    await useApp.getState().stashAction('/w/app', stash, 'pop');
    expect(bridge.edi.git).toHaveBeenLastCalledWith('/w/app', { op: 'stashPop', oid: stash.oid });
    expect(useApp.getState().center.tabs).toEqual([]);
  });

  it('dropping asks first, by the stash title; no means nothing runs', async () => {
    bridge.edi.confirmDropStash.mockResolvedValueOnce(false);
    await useApp.getState().stashAction('/w/app', stash, 'drop');
    expect(bridge.edi.confirmDropStash).toHaveBeenCalledWith('WIP on feat/x');
    expect(bridge.edi.git).not.toHaveBeenCalled();
    bridge.edi.confirmDropStash.mockResolvedValueOnce(true);
    bridge.edi.git.mockResolvedValueOnce({ ok: true, message: 'Stash dropped' });
    await useApp.getState().stashAction('/w/app', stash, 'drop');
    expect(bridge.edi.git).toHaveBeenCalledWith('/w/app', { op: 'stashDrop', oid: stash.oid });
  });
});
