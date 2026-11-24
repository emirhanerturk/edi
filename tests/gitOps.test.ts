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

describe('busyLabel', () => {
  it('returns a label for each operation', () => {
    expect(busyLabel({ op: 'push' })).toBe('Pushing…');
    expect(busyLabel({ op: 'pull' })).toBe('Pulling…');
    expect(busyLabel({ op: 'fetch' })).toBe('Fetching…');
    expect(busyLabel({ op: 'commit', message: 'x', all: false, push: false })).toBe('Committing…');
    expect(busyLabel({ op: 'switch', branch: 'x' })).toBe('Switching…');
    expect(busyLabel({ op: 'createBranch', branch: 'x' })).toBe('Switching…');
    expect(busyLabel({ op: 'undoCommit', oid: 'a'.repeat(40) })).toBe('Undoing commit…');
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
    expect(await ops.branches(repo)).toEqual({ ok: true, branches: ['feat/x', 'main'], current: 'feat/x' });
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
