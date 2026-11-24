// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogResult } from '../../src/git/types';
import type { RepoView } from '../../src/shared/api';

const bridge = vi.hoisted(() => ({
  log: vi.fn(async (_repoPath: string, _count: number): Promise<LogResult> => ({
    ok: true,
    commits: [{ oid: 'f'.repeat(40), short: 'fffffff', subject: 'feat: görünür', authorName: 'a', authorEmail: 'a@x', date: Date.now(), parents: 1, tags: [] }],
    hasMore: false,
    unpushed: [],
    upstream: null,
    userEmail: 'a@x',
  })),
}));
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge }));

const { useApp } = await import('../../src/renderer/store');
const { HistoryPanel } = await import('../../src/renderer/history/HistoryPanel');

afterEach(cleanup);

const repo = (path: string, headOid: string, ahead: number | null = null): RepoView => ({
  name: path.split('/').pop()!,
  path,
  status: { head: 'main', headOid, detached: false, unborn: false, upstream: null, ahead, behind: null, files: [] },
  error: null,
  busy: null,
  claude: 0,
  hasRemote: false,
});
const show = (repos: RepoView[]) =>
  act(() => {
    useApp.setState((state) => ({ workspace: { ...state.workspace, dir: '/w', repos } }));
  });

describe('HistoryPanel', () => {
  it('her reponun logunu bir kez okur; HEAD ya da ahead değişince yeniden', async () => {
    show([repo('/w/a', 'a'.repeat(40)), repo('/w/b', 'b'.repeat(40))]);
    render(<HistoryPanel />);
    expect((await screen.findAllByText('görünür')).length).toBe(2);
    expect(bridge.log.mock.calls.map((call) => call[0]).sort()).toEqual(['/w/a', '/w/b']);
    show([repo('/w/a', 'a'.repeat(40)), repo('/w/b', 'b'.repeat(40))]);
    expect(bridge.log).toHaveBeenCalledTimes(2);
    show([repo('/w/a', 'c'.repeat(40)), repo('/w/b', 'b'.repeat(40), 1)]);
    expect(bridge.log.mock.calls.slice(2).map((call) => call[0]).sort()).toEqual(['/w/a', '/w/b']);
  });
});
