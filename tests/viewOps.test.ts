import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ViewOps } from '../src/main/viewOps.js';
import { Workspace } from '../src/main/workspace.js';
import type { OpResult } from '../src/shared/api.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

async function setup(opts: { commit?: boolean } = { commit: true }) {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', opts);
  await writeFile(join(dir, 'outside.txt'), 'gizli\n');
  const ws = new Workspace({ onChange: () => undefined, statusMs: 60_000 });
  open.push(ws);
  await ws.open(dir);
  const opened: string[] = [];
  const opener = async (target: string): Promise<OpResult> => {
    opened.push(target);
    return { ok: true, message: 'Opened in Zed' };
  };
  return { dir, repo, ws, ops: new ViewOps(ws, opener), opened };
}

const UNKNOWN = { ok: false, error: 'Unknown repository' };

describe('ViewOps', () => {
  it('keşfedilmemiş repo yolu dört işlemde de reddedilir', async () => {
    const { dir, repo, ops, opened } = await setup();
    for (const path of [dir, `${repo}/../a`, `${repo}/`, join(repo, '.git'), '', null, 7, undefined]) {
      expect(await ops.diff(path, 'README.md'), String(path)).toEqual(UNKNOWN);
      expect(await ops.readFile(path, 'README.md'), String(path)).toEqual(UNKNOWN);
      expect(await ops.listFiles(path), String(path)).toEqual(UNKNOWN);
      expect(await ops.openInZed(path, null), String(path)).toEqual(UNKNOWN);
    }
    expect(opened).toEqual([]);
  });

  it('değişen dosyanın diff\'ini ve durum kaydını döner', async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'README.md'), 'değişti\n');
    const view = await ops.diff(repo, 'README.md');
    expect(view).toMatchObject({ ok: true, file: { path: 'README.md', x: '.', y: 'M' }, diff: { added: 1, removed: 1, binary: false } });
    expect(view.ok && view.diff.hunks[0]?.lines).toEqual([
      { kind: 'del', oldNo: 1, text: 'readme' },
      { kind: 'add', newNo: 1, text: 'değişti' },
    ]);
  });

  it("stage'li ve stage'siz değişiklik tek diff'te birlikte gelir", async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'README.md'), 'readme\niki\n');
    await git(repo, 'add', '-A');
    await writeFile(join(repo, 'README.md'), 'readme\niki\nüç\n');
    expect(await ops.diff(repo, 'README.md')).toMatchObject({ ok: true, diff: { added: 2, removed: 0 } });
  });

  it('yeni dosya, tuhaf adlar ve silinen dosya', async () => {
    const { repo, ops } = await setup();
    await mkdir(join(repo, 'boş klasör'));
    await writeFile(join(repo, 'boş klasör', '-tuhaf ad ö.txt'), 'bir\niki\n');
    await rm(join(repo, 'README.md'));

    expect(await ops.diff(repo, 'boş klasör/-tuhaf ad ö.txt')).toMatchObject({
      ok: true,
      file: { kind: 'untracked' },
      diff: { added: 2, removed: 0 },
    });
    expect(await ops.diff(repo, 'README.md')).toMatchObject({ ok: true, diff: { added: 0, removed: 1 } });
  });

  it('yeniden adlandırılan dosyada yalnız içerik değişikliği gelir', async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'uzun.txt'), Array.from({ length: 20 }, (_, i) => `satır ${i}`).join('\n') + '\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: uzun');
    await git(repo, 'mv', 'uzun.txt', 'yeni-ad.txt');
    await writeFile(join(repo, 'yeni-ad.txt'), Array.from({ length: 20 }, (_, i) => (i === 3 ? 'değişti' : `satır ${i}`)).join('\n') + '\n');
    await git(repo, 'add', '-A');

    expect(await ops.diff(repo, 'yeni-ad.txt')).toMatchObject({ ok: true, file: { origPath: 'uzun.txt' }, diff: { added: 1, removed: 1 } });
  });

  it("commit'i olmayan repoda çalışır", async () => {
    const { repo, ops } = await setup({ commit: false });
    await writeFile(join(repo, 'ilk.txt'), 'x\n');
    await git(repo, 'add', '-A');
    expect(await ops.diff(repo, 'ilk.txt')).toMatchObject({ ok: true, diff: { added: 1, removed: 0 } });
  });

  it('değişiklik listesinde olmayan yol için diff çalışmaz', async () => {
    const { repo, ops } = await setup();
    const refused = { ok: false, error: 'File is not in the list of changes' };
    expect(await ops.diff(repo, 'README.md')).toEqual(refused);
    expect(await ops.diff(repo, '../outside.txt')).toEqual(refused);
    expect(await ops.diff(repo, '--output=/tmp/x')).toEqual(refused);
    expect(await ops.diff(repo, 7)).toEqual({ ok: false, error: 'Invalid file path' });
  });

  it('dosya okur ve listeler', async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'yeni.ts'), 'const a = 1;\n');
    expect(await ops.readFile(repo, 'yeni.ts')).toEqual({ ok: true, kind: 'text', text: 'const a = 1;\n', size: 13 });
    expect(await ops.listFiles(repo)).toEqual({ ok: true, files: ['README.md', 'yeni.ts'] });
  });

  it('repo dışına çıkan dosya yolu okunmaz ve açılmaz', async () => {
    const { dir, repo, ops, opened } = await setup();
    const outside = { ok: false, error: 'File is outside the repository' };
    for (const path of ['../outside.txt', join(dir, 'outside.txt'), '.git/config', 'a/../../outside.txt']) {
      expect(await ops.readFile(repo, path), path).toEqual(outside);
      expect(await ops.openInZed(repo, path), path).toEqual(outside);
    }
    expect(await ops.readFile(repo, 7)).toEqual({ ok: false, error: 'Invalid file path' });
    expect(await ops.openInZed(repo, 7)).toEqual({ ok: false, error: 'Invalid file path' });
    expect(opened).toEqual([]);
  });

  it("Zed'de dosyayı, yol verilmezse repo klasörünü açar", async () => {
    const { repo, ops, opened } = await setup();
    expect(await ops.openInZed(repo, 'README.md')).toEqual({ ok: true, message: 'Opened in Zed' });
    expect(await ops.openInZed(repo, null)).toEqual({ ok: true, message: 'Opened in Zed' });
    expect(opened).toEqual([join(repo, 'README.md'), repo]);
  });

  it('silinmiş dosyada repo klasörü açılır', async () => {
    const { repo, ops, opened } = await setup();
    await rm(join(repo, 'README.md'));
    expect((await ops.openInZed(repo, 'README.md')).ok).toBe(true);
    expect(opened).toEqual([repo]);
  });
});
