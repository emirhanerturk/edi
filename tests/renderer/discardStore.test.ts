import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscardTarget, FileChange, GitOp, OpResult, RepoView, WorkspaceView } from '../../src/shared/api';

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
      confirmDiscardChanges: vi.fn<(target: DiscardTarget) => Promise<boolean>>(),
    },
  };
});
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp, connect } = await import('../../src/renderer/store');

const modified: FileChange = { path: 'src/b.ts', origPath: null, x: '.', y: 'M', kind: 'changed' };
const fresh: FileChange = { path: 'new.txt', origPath: null, x: '?', y: '?', kind: 'untracked' };
const stagedOnly: FileChange = { path: 'c.ts', origPath: null, x: 'M', y: '.', kind: 'changed' };
const repo: RepoView = {
  name: 'app',
  path: '/w/app',
  status: { head: 'main', headOid: 'a'.repeat(40), detached: false, unborn: false, upstream: null, ahead: null, behind: null, stashes: 0, files: [modified, fresh, stagedOnly] },
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
};

connect();
beforeEach(() => {
  bridge.edi.git.mockReset();
  bridge.edi.confirmDiscardChanges.mockReset();
  bridge.handlers.workspace!({ ...useApp.getState().workspace, dir: '/w', repos: [repo] } satisfies WorkspaceView);
  useApp.setState({ errors: {}, retries: {} });
});

describe('discarding changes from the store', () => {
  it('a file: asks by its name; no runs nothing, yes discards it', async () => {
    bridge.edi.confirmDiscardChanges.mockResolvedValueOnce(false);
    await useApp.getState().discardChanges('/w/app', modified);
    expect(bridge.edi.confirmDiscardChanges).toHaveBeenCalledWith({ kind: 'file', name: 'b.ts', untracked: false });
    expect(bridge.edi.git).not.toHaveBeenCalled();

    bridge.edi.confirmDiscardChanges.mockResolvedValueOnce(true);
    bridge.edi.git.mockResolvedValueOnce({ ok: true, message: 'Discarded' });
    await useApp.getState().discardChanges('/w/app', fresh);
    expect(bridge.edi.confirmDiscardChanges).toHaveBeenLastCalledWith({ kind: 'file', name: 'new.txt', untracked: true });
    expect(bridge.edi.git).toHaveBeenCalledWith('/w/app', { op: 'discard', file: fresh });
  });

  it('all: counts the CHANGES (not the staged-only file) and discards all on yes', async () => {
    bridge.edi.confirmDiscardChanges.mockResolvedValueOnce(true);
    bridge.edi.git.mockResolvedValueOnce({ ok: true, message: 'Discarded all changes' });
    await useApp.getState().discardChanges('/w/app', null);
    expect(bridge.edi.confirmDiscardChanges).toHaveBeenCalledWith({ kind: 'all', repo: 'app', changed: 1, untracked: 1 });
    expect(bridge.edi.git).toHaveBeenCalledWith('/w/app', { op: 'discardAll' });
  });

  it('an unknown repo asks nothing', async () => {
    await useApp.getState().discardChanges('/w/nope', null);
    expect(bridge.edi.confirmDiscardChanges).not.toHaveBeenCalled();
    expect(bridge.edi.git).not.toHaveBeenCalled();
  });
});
