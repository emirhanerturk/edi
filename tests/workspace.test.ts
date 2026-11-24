import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Workspace } from '../src/main/workspace.js';
import type { WorkspaceView } from '../src/shared/api.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

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
    if (Date.now() - started > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Workspace', () => {
  it('alt klasördeki repolar durumlarıyla gelir', async () => {
    const dir = await makeTmpDir();
    await initRepo(dir, 'b', { commit: true });
    await initRepo(dir, 'a', { commit: true });
    await mkdir(join(dir, 'repo-degil'));
    const { ws } = makeWorkspace();

    expect(await ws.open(dir)).toEqual({ ok: true, repoCount: 2 });
    const view = ws.view();
    expect(view.dir).toBe(dir);
    expect(view.repos.map((r) => r.name)).toEqual(['a', 'b']);
    expect(view.repos[0]).toMatchObject({ path: join(dir, 'a'), error: null, busy: null, claude: 0 });
    expect(view.repos[0]?.status).toMatchObject({ head: 'main', files: [] });
  });

  it('dosya değişince bir sonraki yoklamada görünür ve bildirilir', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const { ws, views } = makeWorkspace();
    await ws.open(dir);

    await writeFile(join(repo, 'yeni.txt'), 'x\n');
    await until(() => ws.view().repos[0]?.status?.files.length === 1);
    expect(ws.view().repos[0]?.status?.files[0]).toMatchObject({ path: 'yeni.txt', kind: 'untracked' });
    expect(views.at(-1)?.repos[0]?.status?.files).toHaveLength(1);
  });

  it('silinen repo hata gösterir, diğerleri yenilenmeye devam eder', async () => {
    const dir = await makeTmpDir();
    const a = await initRepo(dir, 'a', { commit: true });
    const b = await initRepo(dir, 'b', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);

    await rm(a, { recursive: true, force: true });
    await until(() => ws.view().repos[0]?.error !== null);
    expect(ws.view().repos[0]).toMatchObject({ name: 'a', status: null, error: 'Repository folder not found' });

    await writeFile(join(b, 'yeni.txt'), 'x\n');
    await until(() => ws.view().repos[1]?.status?.files.length === 1);
    expect(ws.view().repos[1]?.error).toBeNull();
  });

  it('yalnız keşfedilmiş yollar repo sayılır', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);

    expect(ws.repo(repo)?.name).toBe('a');
    expect(ws.repo(join(repo, 'src'))).toBeNull();
    expect(ws.repo(`${repo}/../a`)).toBeNull(); // aynı klasör, ama keşfedilen yol değil
    expect(ws.repo(`${repo}/`)).toBeNull();
    expect(ws.repo(dir)).toBeNull();
    expect(ws.repo('')).toBeNull();
  });

  it('klasör olmayan yol reddedilir ve açık klasör değişmez', async () => {
    const dir = await makeTmpDir();
    await initRepo(dir, 'a', { commit: true });
    const { ws } = makeWorkspace();
    await ws.open(dir);

    await writeFile(join(dir, 'dosya.txt'), 'x\n');
    expect(await ws.open(join(dir, 'dosya.txt'))).toEqual({ ok: false, error: 'Not a folder' });
    expect(await ws.open(join(dir, 'yok'))).toEqual({ ok: false, error: 'Folder not found' });
    expect(ws.view().dir).toBe(dir);
  });

  it('rescan yeni repoyu bulur, eskisinin durumunu korur', async () => {
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

  it('oturum sayıları repo satırlarına ve köke yazılır', async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const { ws, views } = makeWorkspace();
    await ws.open(dir);

    ws.setSessionCwds([repo, join(repo, 'src'), dir, '/baska/yer']);
    expect(ws.view().repos[0]?.claude).toBe(2);
    expect(ws.view().rootSessions).toBe(1);
    expect(views.at(-1)?.rootSessions).toBe(1);
  });

  it('kapatıldıktan sonra bildirim göndermez', async () => {
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
