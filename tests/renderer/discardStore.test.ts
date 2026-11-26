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
const intentToAdd: FileChange = { path: 'ita.ts', origPath: null, x: '.', y: 'A', kind: 'changed' };
const nested: FileChange = { path: 'nested/', origPath: null, x: '?', y: '?', kind: 'untracked' };
const repo: RepoView = {
  name: 'app',
  path: '/w/app',
  status: { head: 'main', headOid: 'a'.repeat(40), detached: false, unborn: false, upstream: null, ahead: null, behind: null, stashes: 0, files: [modified, fresh, stagedOnly, intentToAdd, nested] },
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

  it('all: counts the CHANGES (an intent-to-add file as new; not the staged-only file or a nested repo) and sends what was shown', async () => {
    bridge.edi.confirmDiscardChanges.mockResolvedValueOnce(true);
    bridge.edi.git.mockResolvedValueOnce({ ok: true, message: 'Discarded all changes' });
    await useApp.getState().discardChanges('/w/app', null);
    expect(bridge.edi.confirmDiscardChanges).toHaveBeenCalledWith({ kind: 'all', repo: 'app', changed: 1, untracked: 2 });
    expect(bridge.edi.git).toHaveBeenCalledWith('/w/app', { op: 'discardAll', files: [modified, fresh, intentToAdd, nested] });
  });

  it('an intent-to-add file is asked about as new', async () => {
    bridge.edi.confirmDiscardChanges.mockResolvedValueOnce(false);
    await useApp.getState().discardChanges('/w/app', intentToAdd);
    expect(bridge.edi.confirmDiscardChanges).toHaveBeenCalledWith({ kind: 'file', name: 'ita.ts', untracked: true });
  });

  it('a nested repo, or all when only it is left, asks nothing', async () => {
    await useApp.getState().discardChanges('/w/app', nested);
    bridge.handlers.workspace!({ ...useApp.getState().workspace, dir: '/w', repos: [{ ...repo, status: { ...repo.status!, files: [nested] } }] } satisfies WorkspaceView);
    await useApp.getState().discardChanges('/w/app', null);
    expect(bridge.edi.confirmDiscardChanges).not.toHaveBeenCalled();
    expect(bridge.edi.git).not.toHaveBeenCalled();
  });

  it('an unknown repo asks nothing', async () => {
    await useApp.getState().discardChanges('/w/nope', null);
    expect(bridge.edi.confirmDiscardChanges).not.toHaveBeenCalled();
    expect(bridge.edi.git).not.toHaveBeenCalled();
  });
});

describe('keeping the repo open', () => {
  it('discard, commit and stash pin a repo that opened by itself; other operations do not', async () => {
    bridge.edi.git.mockResolvedValue({ ok: true, message: '' });
    const ops: GitOp[] = [
      { op: 'discard', file: modified },
      { op: 'discardAll', files: [modified] },
      { op: 'commit', message: 'feat: x', all: true, push: false },
      { op: 'stash', message: '', staged: false },
    ];
    for (const op of ops) {
      useApp.setState({ expanded: {} });
      await useApp.getState().gitOp('/w/app', op);
      expect(useApp.getState().expanded, op.op).toEqual({ '/w/app': true });
    }
    useApp.setState({ expanded: {} });
    await useApp.getState().gitOp('/w/app', { op: 'push' });
    expect(useApp.getState().expanded).toEqual({});
  });

  it('a repo the user closed stays closed', async () => {
    bridge.edi.git.mockResolvedValue({ ok: true, message: '' });
    useApp.setState({ expanded: { '/w/app': false } });
    await useApp.getState().gitOp('/w/app', { op: 'commit', message: 'feat: x', all: true, push: false });
    expect(useApp.getState().expanded).toEqual({ '/w/app': false });
  });
});
