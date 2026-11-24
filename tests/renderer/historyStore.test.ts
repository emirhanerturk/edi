import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogResult } from '../../src/git/types';
import type { RepoView, WorkspaceView } from '../../src/shared/api';

const bridge = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const pending: { repoPath: string; count: number; resolve(log: LogResult): void }[] = [];
  return {
    handlers,
    pending,
    edi: {
      on: (channel: string, handler: (...args: unknown[]) => void) => {
        handlers[channel] = handler;
        return () => undefined;
      },
      getState: () => new Promise(() => undefined),
      claudeUsage: () => new Promise(() => undefined),
      setLayout: vi.fn(),
      log: (repoPath: string, count: number) => new Promise<LogResult>((resolve) => pending.push({ repoPath, count, resolve })),
    },
  };
});
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp, connect } = await import('../../src/renderer/store');

const repo = (path: string, headOid = 'a'.repeat(40)): RepoView => ({
  name: path.split('/').pop()!,
  path,
  status: { head: 'main', headOid, detached: false, unborn: false, upstream: null, ahead: null, behind: null, files: [] },
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
});
const workspace = (dir: string, repos: RepoView[]): WorkspaceView => ({ ...useApp.getState().workspace, dir, repos });
const log = (subject: string, hasMore = false): LogResult => ({
  ok: true,
  commits: [{ oid: 'f'.repeat(40), short: 'fffffff', subject, authorName: 'a', authorEmail: 'a@x', date: 1, parents: 1, tags: [] }],
  hasMore,
  unpushed: [],
  upstream: null,
  userEmail: null,
});

connect();
beforeEach(() => {
  bridge.pending.splice(0);
  bridge.handlers.workspace!(workspace('/bos', []));
  bridge.handlers.workspace!(workspace('/w', [repo('/w/a'), repo('/w/b')]));
});

describe('History store', () => {
  it('logu 50 commitle okur; okunurken eskisi kalır', async () => {
    const first = useApp.getState().loadHistory('/w/a');
    expect(bridge.pending.map((p) => [p.repoPath, p.count])).toEqual([['/w/a', 50]]);
    expect(useApp.getState().history['/w/a']).toMatchObject({ limit: 50, log: null });
    bridge.pending[0]!.resolve(log('ilk'));
    await first;
    const second = useApp.getState().loadHistory('/w/a');
    expect(useApp.getState().history['/w/a']!.log).toEqual(log('ilk'));
    bridge.pending[1]!.resolve(log('ikinci'));
    await second;
    expect(useApp.getState().history['/w/a']!.log).toEqual(log('ikinci'));
  });

  it('geç gelen eski cevap yenisinin üstüne yazılmaz', async () => {
    const old = useApp.getState().loadHistory('/w/a');
    const fresh = useApp.getState().loadHistory('/w/a');
    bridge.pending[1]!.resolve(log('yeni'));
    await fresh;
    bridge.pending[0]!.resolve(log('eski'));
    await old;
    expect(useApp.getState().history['/w/a']!.log).toEqual(log('yeni'));
  });

  it('"Load 50 more" yalnız daha fazlası olan ve süzgeçten geçen repoları büyütür', async () => {
    const a = useApp.getState().loadHistory('/w/a');
    const b = useApp.getState().loadHistory('/w/b');
    bridge.pending[0]!.resolve(log('a', true));
    bridge.pending[1]!.resolve(log('b', false));
    await Promise.all([a, b]);
    useApp.getState().loadMoreHistory();
    expect(bridge.pending.slice(2).map((p) => [p.repoPath, p.count])).toEqual([['/w/a', 100]]);
    useApp.getState().setHistoryFilter('/w/b');
    useApp.getState().loadMoreHistory();
    expect(bridge.pending).toHaveLength(3);
  });

  it('başka klasörde loglar ve süzgeç sıfırlanır; kaybolan reponun logu atılır', async () => {
    const a = useApp.getState().loadHistory('/w/a');
    const b = useApp.getState().loadHistory('/w/b');
    bridge.pending.forEach((p) => p.resolve(log(p.repoPath)));
    await Promise.all([a, b]);
    useApp.getState().setHistoryFilter('/w/b');
    bridge.handlers.workspace!(workspace('/w', [repo('/w/a')]));
    expect(Object.keys(useApp.getState().history)).toEqual(['/w/a']);
    expect(useApp.getState().historyFilter).toBeNull();
    useApp.getState().setHistoryFilter('/w/a');
    bridge.handlers.workspace!(workspace('/baska', [repo('/baska/a')]));
    expect(useApp.getState().history).toEqual({});
    expect(useApp.getState().historyFilter).toBeNull();
  });

  it('düzen seçimi hatırlanır', () => {
    useApp.getState().setHistoryLayout('byRepo');
    expect(useApp.getState().layout.historyLayout).toBe('byRepo');
    expect(bridge.edi.setLayout).toHaveBeenCalledWith({ historyLayout: 'byRepo' });
  });
});
