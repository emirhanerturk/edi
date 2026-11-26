import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitOps, busyLabel } from '../src/main/gitOps.js';
import { Workspace } from '../src/main/workspace.js';
import type { GitOp, WorkspaceView } from '../src/shared/api.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

async function setup(names: string[] = ['a']) {
  const dir = await makeTmpDir();
  const repos: string[] = [];
  for (const name of names) repos.push(await initRepo(dir, name, { commit: true }));
  const views: WorkspaceView[] = [];
  const ws = new Workspace({ onChange: (view) => views.push(view), statusMs: 100 });
  open.push(ws);
  await ws.open(dir);
  return { dir, repos, ws, ops: new GitOps(ws), views };
}

const log = async (repo: string) => (await git(repo, 'log', '--format=%s')).trim().split('\n');
const fileOf = (ws: Workspace, repo: string, path: string) => {
  const found = ws.repo(repo)?.status?.files.find((f) => f.path === path);
  if (!found) throw new Error(`not in status: ${path}`);
  return found;
};

describe('GitOps lock', () => {
  it('lets the repo go and returns the result even if the refresh afterwards fails', async () => {
    const { repos, ws, ops } = await setup();
    const refresh = ws.refresh.bind(ws);
    ws.refresh = async () => {
      throw new Error('status failed');
    };
    const result = await ops.run(repos[0]!, { op: 'createBranch', branch: 'feat/x' });
    expect(result.ok).toBe(true);
    expect(ws.view().repos[0]!.busy).toBeNull();
    ws.refresh = refresh;
    expect((await ops.run(repos[0]!, { op: 'switch', branch: 'main' })).ok).toBe(true);
  });
});

describe('busyLabel', () => {
  it('returns a label for each operation', () => {
    expect(busyLabel({ op: 'push' })).toBe('Pushing…');
    expect(busyLabel({ op: 'pull' })).toBe('Pulling…');
    expect(busyLabel({ op: 'fetch' })).toBe('Fetching…');
    expect(busyLabel({ op: 'commit', message: 'x', all: false, push: false })).toBe('Committing…');
    expect(busyLabel({ op: 'switch', branch: 'x' })).toBe('Switching…');
    expect(busyLabel({ op: 'createBranch', branch: 'x' })).toBe('Switching…');
    expect(busyLabel({ op: 'undoCommit', oid: 'a'.repeat(40) })).toBe('Undoing commit…');
    expect(busyLabel({ op: 'revertCommit', oid: 'a'.repeat(40) })).toBe('Reverting…');
    expect(busyLabel({ op: 'discard', file: { path: 'a', origPath: null, x: '.', y: 'M', kind: 'changed' } })).toBe('Discarding…');
    expect(busyLabel({ op: 'discardAll' })).toBe('Discarding…');
    expect(busyLabel({ op: 'stash', message: '', staged: false })).toBe('Stashing…');
    expect(busyLabel({ op: 'stashPop', oid: 'a'.repeat(40) })).toBe('Popping stash…');
    expect(busyLabel({ op: 'stashApply', oid: 'a'.repeat(40) })).toBe('Applying stash…');
    expect(busyLabel({ op: 'stashDrop', oid: 'a'.repeat(40) })).toBe('Dropping stash…');
    expect(busyLabel({ op: 'stageAll' })).toBe('Working…');
  });
});

describe('GitOps', () => {
  it('rejects a repo path that was not discovered without running git', async () => {
    const { dir, repos, ops } = await setup();
    const repo = repos[0]!;
    await writeFile(join(repo, 'new.txt'), 'x\n');
    const commitAll: GitOp = { op: 'commit', message: 'feat: x', all: true, push: false };
    const unknown = { ok: false, error: 'Unknown repository' };

    expect(await ops.run(dir, commitAll)).toEqual(unknown);
    expect(await ops.run(`${repo}/../a`, commitAll)).toEqual(unknown);
    expect(await ops.run(`${repo}/`, commitAll)).toEqual(unknown);
    expect(await ops.run(join(repo, '.git'), commitAll)).toEqual(unknown);
    expect(await ops.run('', commitAll)).toEqual(unknown);
    expect(await ops.branches(dir)).toEqual(unknown);
    expect(await log(repo)).toEqual(['chore: init']);
  });

  it('rejects an unknown or malformed operation', async () => {
    const { repos, ops } = await setup();
    const repo = repos[0]!;
    const invalid = { ok: false, error: 'Invalid operation' };
    expect(await ops.run(repo, { op: 'reset --hard' } as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, null as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, { op: 'commit', message: 7 } as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, { op: 'switch' } as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, { op: 'stash', message: 'x' } as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, { op: 'stash', message: 'x', staged: false, then: { op: 'push' } } as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, { op: 'stash', message: 'x', staged: false, then: { op: 'switch' } } as unknown as GitOp)).toEqual(invalid);
    // Retrying a switch or pull only makes sense after stashing everything.
    expect(await ops.run(repo, { op: 'stash', message: 'x', staged: true, then: { op: 'pull' } })).toEqual(invalid);
    expect(await ops.run(repo, { op: 'stashDrop', oid: 7 } as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, { op: 'stashPop' } as unknown as GitOp)).toEqual(invalid);
    expect(await ops.run(repo, { op: 'stage', file: { path: '../../etc/passwd' } } as unknown as GitOp)).toEqual({
      ok: false,
      error: 'File is not in the list of changes',
    });
  });

  it('rejects a second operation on the same repo and lets the first finish', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nsleep 1\n');
    await chmod(hook, 0o755);
    await writeFile(join(repo, 'new.txt'), 'x\n');

    const first = ops.run(repo, { op: 'commit', message: 'feat: first', all: true, push: false });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(ws.repo(repo)?.busy).toBe('Committing…');
    expect(await ops.run(repo, { op: 'stageAll' })).toEqual({ ok: false, error: 'Another operation is still running' });
    expect(ws.repo(repo)?.busy).toBe('Committing…'); // the rejected request does not clear the first one's label

    expect(await first).toEqual({ ok: true, message: 'Committed' });
    expect(await log(repo)).toEqual(['feat: first', 'chore: init']);
    expect(ws.repo(repo)?.busy).toBeNull();
  });

  it('does not lock other repos while one repo is busy', async () => {
    const { repos, ops } = await setup(['a', 'b']);
    const [a, b] = repos as [string, string];
    const hook = join(a, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nsleep 1\n');
    await chmod(hook, 0o755);
    await writeFile(join(a, 'new.txt'), 'x\n');
    await writeFile(join(b, 'new.txt'), 'x\n');

    const slow = ops.run(a, { op: 'commit', message: 'feat: a', all: true, push: false });
    expect(await ops.run(b, { op: 'commit', message: 'feat: b', all: true, push: false })).toEqual({ ok: true, message: 'Committed' });
    expect((await slow).ok).toBe(true);
  });

  it('refreshes the status right after an operation and clears busy', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await writeFile(join(repo, 'README.md'), 'changed\n');
    await ws.refresh(repo);

    expect(await ops.run(repo, { op: 'stage', file: fileOf(ws, repo, 'README.md') })).toEqual({ ok: true, message: 'Staged' });
    expect(ws.repo(repo)).toMatchObject({ busy: null });
    expect(fileOf(ws, repo, 'README.md')).toMatchObject({ x: 'M', y: '.' });

    expect((await ops.run(repo, { op: 'unstage', file: fileOf(ws, repo, 'README.md') })).ok).toBe(true);
    expect(fileOf(ws, repo, 'README.md')).toMatchObject({ x: '.', y: 'M' });

    expect((await ops.run(repo, { op: 'stageAll' })).ok).toBe(true);
    expect(fileOf(ws, repo, 'README.md')).toMatchObject({ x: 'M', y: '.' });
    expect((await ops.run(repo, { op: 'unstageAll' })).ok).toBe(true);
    expect(fileOf(ws, repo, 'README.md')).toMatchObject({ x: '.', y: 'M' });
  });

  it("stages the file from the repo's own status, not the object sent by the page", async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'a.ts'), 'x\n');
    await writeFile(join(repo, 'b.ts'), 'x\n');
    await ws.refresh(repo);

    // Even when the page sends the right path with wrong other fields, only that file is staged.
    const forged = { path: 'src/a.ts', origPath: 'b.ts', x: 'R', y: '.', kind: 'changed' as const };
    expect((await ops.run(repo, { op: 'stage', file: forged })).ok).toBe(true);
    expect(ws.repo(repo)?.status?.files.map((f) => `${f.x}${f.y} ${f.path}`).sort()).toEqual(['?? b.ts', 'A. src/a.ts']);
  });

  it('commits and pushes in one operation', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    const bare = await addBareRemote(repo);
    await writeFile(join(repo, 'new.txt'), 'x\n');

    expect(await ops.run(repo, { op: 'commit', message: 'feat: new', all: true, push: true })).toEqual({ ok: true, message: 'Pushed' });
    expect((await git(bare, 'log', '-1', '--format=%s', 'main')).trim()).toBe('feat: new');
    expect(ws.repo(repo)?.status).toMatchObject({ upstream: 'origin/main', ahead: 0, files: [] });
  });

  it('does not try to push when the commit fails', async () => {
    const { repos, ops } = await setup();
    const repo = repos[0]!;
    const bare = await addBareRemote(repo);

    const result = await ops.run(repo, { op: 'commit', message: 'feat: empty', all: true, push: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/nothing to commit/);
    expect(await git(bare, 'for-each-ref')).toBe('');
  });

  it('reports both when the commit succeeds but the push fails', async () => {
    const { repos, ops } = await setup();
    const repo = repos[0]!; // no remote
    await writeFile(join(repo, 'new.txt'), 'x\n');

    const result = await ops.run(repo, { op: 'commit', message: 'feat: new', all: true, push: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Committed, but the push failed: /);
    expect(await log(repo)).toEqual(['feat: new', 'chore: init']);
  });

  it('creates, switches to and lists branches', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    expect(await ops.run(repo, { op: 'createBranch', branch: 'feat/x' })).toEqual({ ok: true, message: 'Switched to feat/x' });
    expect(ws.repo(repo)?.status?.head).toBe('feat/x');
    const list = await ops.branches(repo);
    expect(list.ok && { names: list.branches.map((branch) => branch.name).sort(), current: list.current }).toEqual({ names: ['feat/x', 'main'], current: 'feat/x' });
    expect((await ops.run(repo, { op: 'switch', branch: 'main' })).ok).toBe(true);
    expect(ws.repo(repo)?.status?.head).toBe('main');
    expect(await ops.run(repo, { op: 'switch', branch: '--detach' })).toEqual({ ok: false, error: 'Invalid branch name' });
  });

  it('lists unpushed commits and undoes the newest; a stale oid is refused', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    await writeFile(join(repo, 'new.txt'), 'x\n');
    expect((await ops.run(repo, { op: 'commit', message: 'feat: new', all: true, push: false })).ok).toBe(true);
    const listed = await ops.unpushed(repo);
    expect(listed.ok && listed.commits.map((c) => c.subject)).toEqual(['feat: new']);
    expect(listed.ok && listed.canUndo).toBe(true);
    const oid = listed.ok ? listed.commits[0]!.oid : '';
    expect(await ops.run(repo, { op: 'undoCommit', oid })).toEqual({ ok: true, message: 'Commit undone; its changes are staged' });
    expect(await log(repo)).toEqual(['chore: init']);
    expect(fileOf(ws, repo, 'new.txt').x).toBe('A');
    expect(await ops.run(repo, { op: 'undoCommit', oid })).toEqual({ ok: false, error: 'This is no longer the latest commit' });
    expect(await ops.unpushed('/nope')).toEqual({ ok: false, error: 'Unknown repository' });
  });

  it('discards a change and trashes a new file through the injected Trash; an op without a file is refused', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const ws = new Workspace({ onChange: () => undefined, statusMs: 60_000 });
    open.push(ws);
    await ws.open(dir);
    const trashed: string[] = [];
    const ops = new GitOps(ws, { trash: async (path) => void trashed.push(path) });
    await writeFile(join(repo, 'README.md'), 'edited\n');
    await ws.refresh(repo);
    const file = fileOf(ws, repo, 'README.md');
    expect(await ops.run(repo, { op: 'discard', file })).toEqual({ ok: true, message: 'Discarded' });
    expect(ws.repo(repo)?.status?.files).toEqual([]);
    await writeFile(join(repo, 'new.txt'), 'x\n');
    expect(await ops.run(repo, { op: 'discardAll' })).toEqual({ ok: true, message: 'Discarded all changes' });
    expect(trashed).toEqual([join(repo, 'new.txt')]);
    expect(await ops.run(repo, { op: 'discard' } as unknown as GitOp)).toEqual({ ok: false, error: 'Invalid operation' });
    await writeFile(join(repo, 'other.txt'), 'y\n');
    expect(await new GitOps(ws).run(repo, { op: 'discardAll' })).toEqual({ ok: false, error: 'Moving to the Trash is not available' });
  });

  it('reverts a commit; an op without an oid is refused', async () => {
    const { repos, ops } = await setup();
    const repo = repos[0]!;
    await writeFile(join(repo, 'new.txt'), 'x\n');
    expect((await ops.run(repo, { op: 'commit', message: 'feat: new', all: true, push: false })).ok).toBe(true);
    const oid = (await git(repo, 'rev-parse', 'HEAD')).trim();
    expect(await ops.run(repo, { op: 'revertCommit', oid })).toEqual({ ok: true, message: 'Commit reverted' });
    expect(await log(repo)).toEqual(['Revert "feat: new"', 'feat: new', 'chore: init']);
    expect(await ops.run(repo, { op: 'revertCommit' } as unknown as GitOp)).toEqual({ ok: false, error: 'Invalid operation' });
  });

  it('stashes, lists, pops and drops by stash id; the status counts the stashes', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await writeFile(join(repo, 'README.md'), 'changed\n');
    await writeFile(join(repo, 'new.txt'), 'x\n');
    await ws.refresh(repo);

    expect(await ops.run(repo, { op: 'stash', message: 'first', staged: false })).toEqual({ ok: true, message: 'Stashed' });
    expect(ws.repo(repo)?.status).toMatchObject({ stashes: 1, files: [] });
    await writeFile(join(repo, 'other.txt'), 'y\n');
    expect((await ops.run(repo, { op: 'stash', message: 'second', staged: false })).ok).toBe(true);
    const listed = await ops.stashes(repo);
    expect(listed.ok && listed.stashes.map((s) => s.message)).toEqual(['second', 'first']);
    const [second, first] = listed.ok ? listed.stashes : [];

    const view = await ops.stash(repo, first!.oid);
    expect(view.ok && view.stash.files.map((f) => f.path)).toEqual(['README.md', 'new.txt']);
    expect(await ops.run(repo, { op: 'stashPop', oid: first!.oid })).toEqual({ ok: true, message: 'Stash popped' });
    expect(ws.repo(repo)?.status?.stashes).toBe(1);
    expect(ws.repo(repo)?.status?.files.map((f) => f.path).sort()).toEqual(['README.md', 'new.txt']);
    expect(await ops.run(repo, { op: 'stashDrop', oid: second!.oid })).toEqual({ ok: true, message: 'Stash dropped' });
    expect(ws.repo(repo)?.status?.stashes).toBe(0);
    expect(await ops.run(repo, { op: 'stashDrop', oid: second!.oid })).toEqual({ ok: false, error: 'This stash is no longer in the list' });
    expect(await ops.stashes('/nope')).toEqual({ ok: false, error: 'Unknown repository' });
    expect(await ops.stash('/nope', first!.oid)).toEqual({ ok: false, error: 'Unknown repository' });
  });

  it('"Stash and switch": stashes the changes git refused to carry over, then switches', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await git(repo, 'switch', '-q', '-c', 'feat/x');
    await writeFile(join(repo, 'README.md'), 'feat/x line\n');
    await git(repo, 'commit', '-q', '-am', 'feat: x');
    await git(repo, 'switch', '-q', 'main');
    await writeFile(join(repo, 'README.md'), 'local edit\n');
    await ws.refresh(repo);

    const refused = await ops.run(repo, { op: 'switch', branch: 'feat/x' });
    expect(!refused.ok && refused.error).toMatch(/would be overwritten by checkout/);
    expect(await ops.run(repo, { op: 'stash', message: '', staged: false, then: { op: 'switch', branch: 'feat/x' } })).toEqual({
      ok: true,
      message: 'Switched to feat/x',
    });
    expect(ws.repo(repo)?.status).toMatchObject({ head: 'feat/x', stashes: 1, files: [] });
    const listed = await ops.stashes(repo);
    expect(listed.ok && listed.stashes[0]).toMatchObject({ branch: 'main', message: null });

    // When the retried switch still fails, the stash is kept and both are said.
    await writeFile(join(repo, 'README.md'), 'another edit\n');
    const failed = await ops.run(repo, { op: 'stash', message: '', staged: false, then: { op: 'switch', branch: 'missing' } });
    expect(!failed.ok && failed.error).toMatch(/^Stashed your changes, but the switch failed: /);
    expect(ws.repo(repo)?.status?.stashes).toBe(2);
    expect(ws.repo(repo)?.busy).toBeNull();
  });

  it('fetchAll runs in every repo with a remote and skips the rest', async () => {
    const { repos, ws, ops } = await setup(['a', 'b', 'c']);
    const [a, b] = repos as [string, string, string];
    for (const repo of [a, b]) {
      const bare = await addBareRemote(repo);
      await git(repo, 'push', '-q', '-u', 'origin', 'main');
      // A new commit on the remote, pushed from another clone.
      const peer = join(await makeTmpDir(), 'peer');
      await git(repo, 'clone', '-q', bare, peer);
      await git(peer, 'config', 'user.name', 'Peer');
      await git(peer, 'config', 'user.email', 'peer@example.com');
      await writeFile(join(peer, 'remote.txt'), 'x\n');
      await git(peer, 'add', '-A');
      await git(peer, 'commit', '-q', '-m', 'feat: remote');
      await git(peer, 'push', '-q');
    }
    await ws.rescan();

    const results = await ops.fetchAll();
    expect(results.map((r) => [r.repoPath.split('/').at(-1), r.result.ok])).toEqual([
      ['a', true],
      ['b', true],
    ]);
    expect(ws.view().repos.map((r) => r.status?.behind)).toEqual([1, 1, null]);
  });

  it('rejects unstageAll during a conflict so the conflict cannot vanish and become committable', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await git(repo, 'switch', '-q', '-c', 'feat/x');
    await writeFile(join(repo, 'README.md'), 'feat/x line\n');
    await writeFile(join(repo, 'clean.txt'), 'x\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: x');
    await git(repo, 'switch', '-q', 'main');
    await writeFile(join(repo, 'README.md'), 'main line\n');
    await git(repo, 'commit', '-q', '-am', 'feat: main');
    await git(repo, 'merge', 'feat/x').catch(() => undefined); // ends in a conflict; clean.txt is staged

    expect(await ops.run(repo, { op: 'unstageAll' })).toEqual({ ok: false, error: 'Conflicted files present; resolve them outside edi' });
    expect(ws.repo(repo)?.status?.files.map((f) => `${f.kind} ${f.path}`).sort()).toEqual(['changed clean.txt', 'conflicted README.md']);
    // The guard holds, so the conflict markers cannot be committed.
    const committed = await ops.run(repo, { op: 'commit', message: 'feat: x', all: true, push: false });
    expect(committed.ok).toBe(false);
    expect((await git(repo, 'rev-list', '--count', 'HEAD')).trim()).toBe('2');
  });
});

describe('fetchQuietly', () => {
  /** A repo with a remote and a teammate's clone of it; `peerPush` adds a commit there and pushes it. */
  async function withPeer() {
    const { repos, ws, ops, views } = await setup();
    const repo = repos[0]!;
    const bare = await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    const peer = join(await makeTmpDir(), 'peer');
    await git(repo, 'clone', '-q', bare, peer);
    await git(peer, 'config', 'user.name', 'Peer');
    await git(peer, 'config', 'user.email', 'peer@example.com');
    let n = 0;
    const peerPush = async () => {
      await writeFile(join(peer, `remote-${++n}.txt`), 'x\n');
      await git(peer, 'add', '-A');
      await git(peer, 'commit', '-q', '-m', `feat: remote ${n}`);
      await git(peer, 'push', '-q');
    };
    await ws.rescan();
    return { repo, bare, ws, ops, views, peerPush };
  }

  it("brings in a teammate's push without a busy label: the Pull count shows it", async () => {
    const { repo, ws, ops, views, peerPush } = await withPeer();
    await peerPush();
    views.length = 0;
    expect(await ops.fetchQuietly(repo)).toBe(true);
    expect(ws.repo(repo)?.status?.behind).toBe(1);
    expect(views.every((v) => v.repos.every((r) => r.busy === null))).toBe(true);
  });

  it('skips a repo without a remote, one with an operation running, and a path that was not discovered', async () => {
    const { repos, ops, ws } = await setup();
    expect(await ops.fetchQuietly(repos[0]!)).toBe(false);
    const { repo, ops: peerOps } = await withPeer();
    ws.setBusy(repos[0]!, 'Pushing…');
    expect(await ops.fetchQuietly(repos[0]!)).toBe(false);
    expect(await peerOps.fetchQuietly(`${repo}/..`)).toBe(false);
  });

  it('an operation started during it waits for it instead of being refused', async () => {
    const { repo, ws, ops, peerPush } = await withPeer();
    await peerPush();
    const quiet = ops.fetchQuietly(repo);
    expect(await ops.run(repo, { op: 'pull' })).toEqual({ ok: true, message: 'Pulled' });
    expect(await quiet).toBe(true);
    expect(ws.repo(repo)?.status?.behind).toBe(0);
  });

  it('after three failures in a row it leaves the repo alone, until a fetch of the user succeeds', async () => {
    const { repo, bare, ops } = await withPeer();
    await git(repo, 'remote', 'set-url', 'origin', `${bare}-missing`);
    for (let i = 0; i < 3; i++) expect(await ops.fetchQuietly(repo)).toBe(true);
    expect(await ops.fetchQuietly(repo)).toBe(false);
    await git(repo, 'remote', 'set-url', 'origin', bare);
    expect(await ops.fetchQuietly(repo)).toBe(false);
    expect((await ops.run(repo, { op: 'fetch' })).ok).toBe(true);
    expect(await ops.fetchQuietly(repo)).toBe(true);
  });
});
