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
const commit = (message: string): GitOp => ({ op: 'commit', message, all: false, push: false });

/** Starts a commit whose result arrives only when `finish` is called, like one waiting on a hook. */
function slowCommit(message: string) {
  let finish!: (result: OpResult) => void;
  bridge.edi.git.mockReturnValueOnce(new Promise<OpResult>((resolve) => (finish = resolve)));
  const done = useApp.getState().gitOp('/w/app', commit(message));
  return { done, finish };
}

connect();
beforeEach(() => {
  bridge.edi.git.mockReset();
  bridge.handlers.workspace!({ ...useApp.getState().workspace, dir: '/w', repos: [repo] } satisfies WorkspaceView);
  useApp.setState({ errors: {}, retries: {}, drafts: {} });
});

describe('the commit message box', () => {
  it('is cleared once the commit goes through', async () => {
    useApp.getState().setDraft('/w/app', 'feat: x');
    const { done, finish } = slowCommit('feat: x');
    finish({ ok: true, message: 'Committed' });
    await done;
    expect(useApp.getState().drafts['/w/app']).toBeUndefined();
  });

  it('keeps text typed while the hook was running', async () => {
    useApp.getState().setDraft('/w/app', 'feat: x');
    const { done, finish } = slowCommit('feat: x');
    useApp.getState().setDraft('/w/app', 'feat: x\n\nmore detail');
    finish({ ok: true, message: 'Committed' });
    await done;
    expect(useApp.getState().drafts['/w/app']).toBe('feat: x\n\nmore detail');
  });

  it('keeps text typed meanwhile when the commit went through but its push failed', async () => {
    useApp.getState().setDraft('/w/app', 'feat: x');
    const { done, finish } = slowCommit('feat: x');
    useApp.getState().setDraft('/w/app', 'feat: y');
    finish({ ok: false, error: 'Committed, but the push failed: rejected' });
    await done;
    expect(useApp.getState().drafts['/w/app']).toBe('feat: y');
  });

  it('keeps the message when the commit fails', async () => {
    useApp.getState().setDraft('/w/app', 'feat: x');
    const { done, finish } = slowCommit('feat: x');
    finish({ ok: false, error: 'pre-commit hook failed' });
    await done;
    expect(useApp.getState().drafts['/w/app']).toBe('feat: x');
  });
});
