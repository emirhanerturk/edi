import { access, chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Workspace } from '../src/main/workspace.js';
import type { WorkspaceView } from '../src/shared/api.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

function makeWorkspace() {
  const views: WorkspaceView[] = [];
  const ws = new Workspace({ onChange: (view) => views.push(view), statusMs: 50 });
  open.push(ws);
  return { ws, views };
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('the expected state never arrived');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Workspace', () => {
  it('returns the repos in subfolders with their status', async () => {
    const dir = await makeTmpDir();
    await initRepo(dir, 'b', { commit: true });
    await initRepo(dir, 'a', { commit: true });
    await mkdir(join(dir, 'not-a-repo'));
    const { ws } = makeWorkspace();

    expect(await ws.open(dir)).toEqual({ ok: true, repoCount: 2 });
    const view = ws.view();
    expect(view.dir).toBe(dir);
    expect(view.repos.map((r) => r.name)).toEqual(['a', 'b']);
    expect(view.repos[0]).toMatchObject({ path: join(dir, 'a'), error: null, busy: null, claude: 0, hasRemote: false });
    expect(view.repos[0]?.status).toMatchObject({ head: 'main', files: [] });
  });

  it('shows and reports a file change on the next poll', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const { ws, views } = makeWorkspace();
    await ws.open(dir);

    await writeFile(join(repo, 'new.txt'), 'x\n');
    await until(() => ws.view().repos[0]?.status?.files.length === 1);
    expect(ws.view().repos[0]?.status?.files[0]).toMatchObject({ path: 'new.txt', kind: 'untracked' });
    expect(views.at(-1)?.repos[0]?.status?.files).toHaveLength(1);
  });

  it('shows an error for a deleted repo while the others keep refreshing', async () => {
    const dir = await makeTmpDir();
    const a = await initRepo(dir, 'a', { commit: true });
    const b = await initRepo(dir, 'b', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);

    await rm(a, { recursive: true, force: true });
    await until(() => ws.view().repos[0]?.error !== null);
    expect(ws.view().repos[0]).toMatchObject({ name: 'a', status: null, error: 'Repository folder not found' });

    await writeFile(join(b, 'new.txt'), 'x\n');
    await until(() => ws.view().repos[1]?.status?.files.length === 1);
    expect(ws.view().repos[1]?.error).toBeNull();
  });

  it("reports a fast repo's change while a slow repo's status is still being read", async () => {
    const dir = await makeTmpDir();
    const slow = await initRepo(dir, 'a', { commit: true });
    const fast = await initRepo(dir, 'b', { commit: true });
    const { ws, views } = makeWorkspace();
    await ws.open(dir);

    // git status in the slow repo runs this fsmonitor hook, which waits until the test releases it.
    const hooks = await makeTmpDir();
    const hook = join(hooks, 'wait.sh');
    await writeFile(hook, `#!/bin/sh\ntouch "${hooks}/started"\nwhile [ ! -f "${hooks}/release" ]; do sleep 0.05; done\nexit 1\n`);
    await chmod(hook, 0o755);
    await git(slow, 'config', 'core.fsmonitor', hook);
    const exists = (file: string) => access(file).then(() => true, () => false);
    try {
      let started = false;
      await until(() => {
        void exists(join(hooks, 'started')).then((yes) => (started = yes));
        return started;
      });

      await writeFile(join(fast, 'new.txt'), 'x\n');
      await until(() => views.at(-1)?.repos[1]?.status?.files.length === 1, 2000);
    } finally {
      await writeFile(join(hooks, 'release'), '');
    }
  });

  it('of two folders opened at once, one wins with its own repos and the other gives way', async () => {
    const first = await makeTmpDir();
    for (const name of ['a', 'b', 'c', 'd']) await initRepo(first, name, { commit: true });
    const second = await makeTmpDir();
    await initRepo(second, 'z', { commit: true });
    const { ws } = makeWorkspace();

    // Which one wins depends on which folder check ends last; the app itself opens one at a time.
    const results = await Promise.all([ws.open(first), ws.open(second)]);
    const won = results.findIndex((result) => result.ok);
    expect(results[1 - won]).toEqual({ ok: false, error: 'Another folder was opened' });
    expect(ws.view().dir).toBe(won === 0 ? first : second);
    expect(ws.view().repos.map((repo) => repo.name)).toEqual(won === 0 ? ['a', 'b', 'c', 'd'] : ['z']);
  });

  it('notices a new tag, which changes no status', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);
    await until(() => (ws.view().repos[0]?.refs ?? 0) > 0);
    const before = ws.view().repos[0]!.refs!;
    // A tag in a folder of its own: the new folder and its parent both change.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await git(repo, 'tag', 'release/v1');
    await until(() => ws.view().repos[0]!.refs! > before);
  });

  it('treats only discovered paths as repos', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);

    expect(ws.repo(repo)?.name).toBe('a');
    expect(ws.repo(join(repo, 'src'))).toBeNull();
    expect(ws.repo(`${repo}/../a`)).toBeNull(); // the same folder, but not the discovered path
    expect(ws.repo(`${repo}/`)).toBeNull();
    expect(ws.repo(dir)).toBeNull();
    expect(ws.repo('')).toBeNull();
  });

  it('rejects a path that is not a folder and keeps the open folder', async () => {
    const dir = await makeTmpDir();
    await initRepo(dir, 'a', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);

    await writeFile(join(dir, 'file.txt'), 'x\n');
    expect(await ws.open(join(dir, 'file.txt'))).toEqual({ ok: false, error: 'Not a folder' });
    expect(await ws.open(join(dir, 'missing'))).toEqual({ ok: false, error: 'Folder not found' });
    expect(ws.view().dir).toBe(dir);
  });

  it("rescan finds a new repo and keeps the existing one's state", async () => {
    const dir = await makeTmpDir();
    await initRepo(dir, 'a', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);
    ws.setBusy(join(dir, 'a'), 'Pushing…');

    await initRepo(dir, 'b', { commit: true });
    await ws.rescan();
    expect(ws.view().repos.map((r) => [r.name, r.busy])).toEqual([
      ['a', 'Pushing…'],
      ['b', null],
    ]);
    expect(ws.view().repos[1]?.status?.head).toBe('main');
  });

  it('reports whether a repo has a remote, picking up one added later on rescan', async () => {
    const dir = await makeTmpDir();
    const a = await initRepo(dir, 'a', { commit: true });
    const b = await initRepo(dir, 'b', { commit: true });
    await addBareRemote(b);
    const { ws } = makeWorkspace();
    await ws.open(dir);
    expect(ws.view().repos.map((r) => r.hasRemote)).toEqual([false, true]);

    await addBareRemote(a);
    await ws.rescan();
    expect(ws.view().repos.map((r) => r.hasRemote)).toEqual([true, true]);
  });

  it('writes session counts to the repo rows and the root', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const { ws, views } = makeWorkspace();
    await ws.open(dir);

    ws.setSessionCwds([repo, join(repo, 'src'), dir, '/elsewhere']);
    expect(ws.view().repos[0]?.claude).toBe(2);
    expect(ws.view().rootSessions).toBe(1);
    expect(views.at(-1)?.rootSessions).toBe(1);
  });

  describe('in the project order, without the ignored repos', () => {
    async function fourRepos() {
      const dir = await makeTmpDir();
      for (const name of ['a', 'b', 'c', 'd']) await initRepo(dir, name, { commit: true });
      return dir;
    }
    const names = (ws: Workspace) => ws.view().repos.map((repo) => repo.name);

    it('lists the repos in the project order without the ignored ones, and counts only those', async () => {
      const dir = await fourRepos();
      const { ws } = makeWorkspace();
      expect(await ws.open(dir, { order: ['c'], ignored: ['b'] })).toEqual({ ok: true, repoCount: 3 });
      expect(names(ws)).toEqual(['c', 'a', 'd']);
      expect(ws.repo(join(dir, 'b'))).toBeNull();
    });

    it('new settings apply at once and keep the state of the repos that stay', async () => {
      const dir = await fourRepos();
      const { ws, views } = makeWorkspace();
      await ws.open(dir);
      ws.setBusy(join(dir, 'a'), 'Pushing…');
      await ws.setRepoSettings({ order: ['b', 'a'], ignored: ['c'] });
      expect(ws.view().repos.map((repo) => [repo.name, repo.busy])).toEqual([
        ['b', null],
        ['a', 'Pushing…'],
        ['d', null],
      ]);
      expect(ws.repo(join(dir, 'c'))).toBeNull();
      expect(views.at(-1)?.repos.map((repo) => repo.name)).toEqual(['b', 'a', 'd']);
    });

    it('a repo made later shows at the end; the settings stay on rescan', async () => {
      const dir = await fourRepos();
      const { ws } = makeWorkspace();
      await ws.open(dir, { order: ['b', 'a'], ignored: ['c'] });
      await initRepo(dir, 'e', { commit: true });
      await ws.rescan();
      expect(names(ws)).toEqual(['b', 'a', 'd', 'e']);
    });

    it('a folder that is itself a repo shows, whatever the settings say', async () => {
      const dir = await initRepo(await makeTmpDir(), 'solo', { commit: true });
      const { ws } = makeWorkspace();
      expect(await ws.open(dir, { order: [], ignored: ['solo'] })).toEqual({ ok: true, repoCount: 1 });
      expect(names(ws)).toEqual(['solo']);
    });

    it('with every repo ignored, the folder opens with none', async () => {
      const dir = await fourRepos();
      const { ws } = makeWorkspace();
      expect(await ws.open(dir, { order: [], ignored: ['a', 'b', 'c', 'd'] })).toEqual({ ok: true, repoCount: 0 });
      expect(ws.view().repos).toEqual([]);
    });

    it('opening without settings forgets the previous folder\'s', async () => {
      const dir = await fourRepos();
      const { ws } = makeWorkspace();
      await ws.open(dir, { order: [], ignored: ['a'] });
      await ws.open(dir);
      expect(names(ws)).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  it('sends no updates after being disposed', async () => {
    const dir = await makeTmpDir();
    await initRepo(dir, 'a', { commit: true });
    const { ws, views } = makeWorkspace();
    await ws.open(dir);
    ws.dispose();
    const count = views.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(views.length).toBe(count);
  });
});
