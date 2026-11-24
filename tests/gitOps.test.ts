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
  if (!found) throw new Error(`durumda yok: ${path}`);
  return found;
};

describe('busyLabel', () => {
  it('işleme göre etiket verir', () => {
    expect(busyLabel({ op: 'push' })).toBe('Pushing…');
    expect(busyLabel({ op: 'pull' })).toBe('Pulling…');
    expect(busyLabel({ op: 'fetch' })).toBe('Fetching…');
    expect(busyLabel({ op: 'commit', message: 'x', all: false, push: false })).toBe('Committing…');
    expect(busyLabel({ op: 'switch', branch: 'x' })).toBe('Switching…');
    expect(busyLabel({ op: 'createBranch', branch: 'x' })).toBe('Switching…');
    expect(busyLabel({ op: 'stageAll' })).toBe('Working…');
  });
});

describe('GitOps', () => {
  it('keşfedilmemiş repo yolu reddedilir, git çalışmaz', async () => {
    const { dir, repos, ops } = await setup();
    const repo = repos[0]!;
    await writeFile(join(repo, 'yeni.txt'), 'x\n');
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

  it('tanınmayan ya da bozuk işlem reddedilir', async () => {
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

  it('aynı repoda ikinci işlem reddedilir, ilki tamamlanır', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nsleep 1\n');
    await chmod(hook, 0o755);
    await writeFile(join(repo, 'yeni.txt'), 'x\n');

    const first = ops.run(repo, { op: 'commit', message: 'feat: ilk', all: true, push: false });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(ws.repo(repo)?.busy).toBe('Committing…');
    expect(await ops.run(repo, { op: 'stageAll' })).toEqual({ ok: false, error: 'Another operation is still running' });
    expect(ws.repo(repo)?.busy).toBe('Committing…'); // reddedilen istek ilkinin etiketini silmez

    expect(await first).toEqual({ ok: true, message: 'Committed' });
    expect(await log(repo)).toEqual(['feat: ilk', 'chore: init']);
    expect(ws.repo(repo)?.busy).toBeNull();
  });

  it('bir repodaki işlem diğer repoyu kilitlemez', async () => {
    const { repos, ops } = await setup(['a', 'b']);
    const [a, b] = repos as [string, string];
    const hook = join(a, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nsleep 1\n');
    await chmod(hook, 0o755);
    await writeFile(join(a, 'yeni.txt'), 'x\n');
    await writeFile(join(b, 'yeni.txt'), 'x\n');

    const slow = ops.run(a, { op: 'commit', message: 'feat: a', all: true, push: false });
    expect(await ops.run(b, { op: 'commit', message: 'feat: b', all: true, push: false })).toEqual({ ok: true, message: 'Committed' });
    expect((await slow).ok).toBe(true);
  });

  it('işlemden sonra durum hemen yenilenir ve busy temizlenir', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await writeFile(join(repo, 'README.md'), 'değişti\n');
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

  it("stage işlemi sayfanın gönderdiği nesneyi değil, reponun kendi durumundaki dosyayı kullanır", async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'a.ts'), 'x\n');
    await writeFile(join(repo, 'b.ts'), 'x\n');
    await ws.refresh(repo);

    // Sayfa yolu doğru, gerisini yanlış gönderse de yalnız o dosya stage edilir.
    const forged = { path: 'src/a.ts', origPath: 'b.ts', x: 'R', y: '.', kind: 'changed' as const };
    expect((await ops.run(repo, { op: 'stage', file: forged })).ok).toBe(true);
    expect(ws.repo(repo)?.status?.files.map((f) => `${f.x}${f.y} ${f.path}`).sort()).toEqual(['?? b.ts', 'A. src/a.ts']);
  });

  it('commit ve push tek işlemde', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    const bare = await addBareRemote(repo);
    await writeFile(join(repo, 'yeni.txt'), 'x\n');

    expect(await ops.run(repo, { op: 'commit', message: 'feat: yeni', all: true, push: true })).toEqual({ ok: true, message: 'Pushed' });
    expect((await git(bare, 'log', '-1', '--format=%s', 'main')).trim()).toBe('feat: yeni');
    expect(ws.repo(repo)?.status).toMatchObject({ upstream: 'origin/main', ahead: 0, files: [] });
  });

  it('commit başarısızsa push denenmez', async () => {
    const { repos, ops } = await setup();
    const repo = repos[0]!;
    const bare = await addBareRemote(repo);

    const result = await ops.run(repo, { op: 'commit', message: 'feat: boş', all: true, push: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/nothing to commit/);
    expect(await git(bare, 'for-each-ref')).toBe('');
  });

  it('commit başarılı, push başarısızsa ikisini de söyler', async () => {
    const { repos, ops } = await setup();
    const repo = repos[0]!; // remote yok
    await writeFile(join(repo, 'yeni.txt'), 'x\n');

    const result = await ops.run(repo, { op: 'commit', message: 'feat: yeni', all: true, push: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Committed, but the push failed: /);
    expect(await log(repo)).toEqual(['feat: yeni', 'chore: init']);
  });

  it('branch açar, geçer ve listeler', async () => {
    const { repos, ws, ops } = await setup();
    const repo = repos[0]!;
    expect(await ops.run(repo, { op: 'createBranch', branch: 'feat/x' })).toEqual({ ok: true, message: 'Switched to feat/x' });
    expect(ws.repo(repo)?.status?.head).toBe('feat/x');
    expect(await ops.branches(repo)).toEqual({ ok: true, branches: ['feat/x', 'main'], current: 'feat/x' });
    expect((await ops.run(repo, { op: 'switch', branch: 'main' })).ok).toBe(true);
    expect(ws.repo(repo)?.status?.head).toBe('main');
    expect(await ops.run(repo, { op: 'switch', branch: '--detach' })).toEqual({ ok: false, error: 'Invalid branch name' });
  });

  it("fetchAll remote'u olan tüm repolarda çalışır, olmayanı atlar", async () => {
    const { repos, ws, ops } = await setup(['a', 'b', 'c']);
    const [a, b] = repos as [string, string, string];
    for (const repo of [a, b]) {
      const bare = await addBareRemote(repo);
      await git(repo, 'push', '-q', '-u', 'origin', 'main');
      // Uzakta yeni bir commit: başka bir klondan gönderilir.
      const peer = join(await makeTmpDir(), 'peer');
      await git(repo, 'clone', '-q', bare, peer);
      await git(peer, 'config', 'user.name', 'Peer');
      await git(peer, 'config', 'user.email', 'peer@example.com');
      await writeFile(join(peer, 'uzak.txt'), 'x\n');
      await git(peer, 'add', '-A');
      await git(peer, 'commit', '-q', '-m', 'feat: uzak');
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
});
