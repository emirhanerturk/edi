import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commit,
  createBranch,
  diffFile,
  diffRepo,
  fetchRepo,
  listBranches,
  pull,
  push,
  stageAll,
  stageFile,
  switchBranch,
  unstageAll,
  unstageFile,
} from '../src/git/actions.js';
import { type FileChange, type RepoStatus, getStatus, hasUnstaged, isStaged } from '../src/git/status.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

async function statusOf(repo: string): Promise<RepoStatus> {
  const r = await getStatus(repo);
  if (!r.ok) throw new Error(r.error);
  return r.status;
}

async function fileOf(repo: string, path: string): Promise<FileChange> {
  const found = (await statusOf(repo)).files.find((f) => f.path === path);
  if (!found) throw new Error(`durumda yok: ${path}`);
  return found;
}

const newRepo = async (opts: { commit?: boolean } = { commit: true }) => initRepo(await makeTmpDir(), 'a', opts);
const head = async (repo: string) => (await git(repo, 'rev-parse', 'HEAD')).trim();
const commitCount = async (repo: string) => Number((await git(repo, 'rev-list', '--count', 'HEAD')).trim());
const write = (repo: string, path: string, content: string) => writeFile(join(repo, path), content);

/** origin'i olan ve main'i oraya gönderilmiş repo + aynı origin'in ikinci klonu. */
async function repoWithRemoteAndPeer() {
  const repo = await newRepo();
  const bare = await addBareRemote(repo);
  await git(repo, 'push', '-q', '-u', 'origin', 'main');
  const peer = join(await makeTmpDir(), 'peer');
  await git(repo, 'clone', '-q', bare, peer);
  await git(peer, 'config', 'user.name', 'Peer');
  await git(peer, 'config', 'user.email', 'peer@example.com');
  return { repo, bare, peer };
}

async function peerPushes(peer: string, name: string) {
  await write(peer, name, 'uzaktan\n');
  await git(peer, 'add', '-A');
  await git(peer, 'commit', '-q', '-m', `feat: ${name}`);
  await git(peer, 'push', '-q');
}

describe('stage / unstage', () => {
  it('boşluklu ve Türkçe karakterli dosyayı stage eder ve geri alır', async () => {
    const repo = await newRepo();
    await write(repo, 'boş dosya.txt', 'x\n');

    expect(await stageFile(repo, await fileOf(repo, 'boş dosya.txt'))).toEqual({ ok: true, message: 'stage edildi' });
    expect(await fileOf(repo, 'boş dosya.txt')).toMatchObject({ x: 'A', y: '.' });

    expect(await unstageFile(repo, await fileOf(repo, 'boş dosya.txt'))).toEqual({
      ok: true,
      message: 'unstage edildi',
    });
    expect(await fileOf(repo, 'boş dosya.txt')).toMatchObject({ kind: 'untracked' });
  });

  it("commit'i olmayan repoda unstage çalışır", async () => {
    const repo = await newRepo({});
    await write(repo, 'ilk.txt', 'x\n');
    await stageFile(repo, await fileOf(repo, 'ilk.txt'));

    expect((await unstageFile(repo, await fileOf(repo, 'ilk.txt'))).ok).toBe(true);
    expect(await fileOf(repo, 'ilk.txt')).toMatchObject({ kind: 'untracked' });
  });

  it("stage'li rename unstage edilince stage'li kayıt kalmaz", async () => {
    const repo = await newRepo();
    await write(repo, 'eski ad.txt', 'aynı içerik\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: dosya');
    await git(repo, 'mv', 'eski ad.txt', 'yeni ad.txt');
    const renamed = await fileOf(repo, 'yeni ad.txt');
    expect(renamed).toMatchObject({ x: 'R', origPath: 'eski ad.txt' });

    expect((await unstageFile(repo, renamed)).ok).toBe(true);
    const files = (await statusOf(repo)).files;
    expect(files.some(isStaged)).toBe(false);
    expect(files.map((f) => f.path).sort()).toEqual(['eski ad.txt', 'yeni ad.txt']);
  });

  it('silinmiş dosyayı stage eder', async () => {
    const repo = await newRepo();
    await rm(join(repo, 'README.md'));

    expect((await stageFile(repo, await fileOf(repo, 'README.md'))).ok).toBe(true);
    expect(await fileOf(repo, 'README.md')).toMatchObject({ x: 'D', y: '.' });
  });

  it('stageAll hepsini stage eder, unstageAll hepsini geri alır', async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'değişti\n');
    await write(repo, 'yeni.txt', 'x\n');

    expect((await stageAll(repo)).ok).toBe(true);
    expect((await statusOf(repo)).files.every((f) => isStaged(f) && !hasUnstaged(f))).toBe(true);

    expect((await unstageAll(repo)).ok).toBe(true);
    const files = (await statusOf(repo)).files;
    expect(files).toHaveLength(2);
    expect(files.some(isStaged)).toBe(false);
  });
});

describe('commit', () => {
  it("yalnız stage'lileri commit eder", async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'değişti\n');
    await write(repo, 'a.txt', 'x\n');
    await git(repo, 'add', 'a.txt');

    expect(await commit(repo, 'feat: x', { addAll: false })).toEqual({ ok: true, message: 'commit edildi' });
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('feat: x\n');
    expect((await statusOf(repo)).files).toEqual([
      { path: 'README.md', origPath: null, x: '.', y: 'M', kind: 'changed' },
    ]);
  });

  it('addAll ile yeni dosyaları da commit eder', async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'değişti\n');
    await write(repo, 'yeni.txt', 'x\n');

    expect((await commit(repo, 'feat: hepsi', { addAll: true })).ok).toBe(true);
    expect((await statusOf(repo)).files).toEqual([]);
    expect(await commitCount(repo)).toBe(2);
  });

  it('Türkçe karakterli mesajı aynen yazar', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'fix: çökme düzeltildi', { addAll: true });
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('fix: çökme düzeltildi\n');
  });

  it('boş mesajla commit etmez', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    await git(repo, 'add', '-A');

    expect(await commit(repo, '   ', { addAll: false })).toEqual({ ok: false, error: 'commit mesajı boş' });
    expect(await commitCount(repo)).toBe(1);
  });

  it("commit edilecek bir şey yokken git'in açıklamasını döner", async () => {
    const repo = await newRepo();
    const r = await commit(repo, 'feat: boş', { addAll: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/nothing to commit/);
    expect(await commitCount(repo)).toBe(1);
  });

  it('pre-commit hook reddederse commit atılmaz ve hook çıktısı döner', async () => {
    const repo = await newRepo();
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'a.txt', 'x\n');

    expect(await commit(repo, 'feat: x', { addAll: true })).toEqual({ ok: false, error: 'lint failed' });
    expect(await commitCount(repo)).toBe(1);
  });
});

describe('index kilidi', () => {
  it('index.lock varken yazma işlemi hata döner, durum okunmaya devam eder', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    const file = await fileOf(repo, 'a.txt');
    await writeFile(join(repo, '.git', 'index.lock'), '');

    const r = await stageFile(repo, file);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('index.lock');
    expect((await getStatus(repo)).ok).toBe(true);
  });
});

describe('push / pull / fetch', () => {
  it("upstream'siz branch'i origin'e upstream kurarak gönderir", async () => {
    const repo = await newRepo();
    const bare = await addBareRemote(repo);
    expect((await statusOf(repo)).upstream).toBeNull();

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: true, message: 'push edildi' });
    expect(await statusOf(repo)).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 });
    expect((await git(bare, 'rev-parse', 'main')).trim()).toBe(await head(repo));
  });

  it('upstream varken yeni commit gönderir', async () => {
    const { repo, bare } = await repoWithRemoteAndPeer();
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'feat: a', { addAll: true });
    expect((await statusOf(repo)).ahead).toBe(1);

    expect((await push(repo, await statusOf(repo))).ok).toBe(true);
    expect((await git(bare, 'rev-parse', 'main')).trim()).toBe(await head(repo));
  });

  it('origin yokken hata döner', async () => {
    const repo = await newRepo();
    expect((await push(repo, await statusOf(repo))).ok).toBe(false);
  });

  it('detached HEAD push edilmez', async () => {
    const repo = await newRepo();
    await addBareRemote(repo);
    await git(repo, 'checkout', '-q', '--detach');
    expect(await push(repo, await statusOf(repo))).toEqual({ ok: false, error: 'detached HEAD: push edilemez' });
  });

  it('uzaktaki commit reddedilen push zorlanmaz', async () => {
    const { repo, bare, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'uzak.txt');
    const remoteHead = (await git(bare, 'rev-parse', 'main')).trim();
    await write(repo, 'yerel.txt', 'x\n');
    await commit(repo, 'feat: yerel', { addAll: true });

    const r = await push(repo, await statusOf(repo));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('[rejected]');
    expect((await git(bare, 'rev-parse', 'main')).trim()).toBe(remoteHead);
  });

  it('pull fast-forward eder', async () => {
    const { repo, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'uzak.txt');

    expect(await pull(repo)).toEqual({ ok: true, message: 'pull edildi' });
    expect(await head(repo)).toBe(await head(peer));
  });

  it('ayrışmış geçmişte pull hata döner ve HEAD değişmez', async () => {
    const { repo, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'uzak.txt');
    await write(repo, 'yerel.txt', 'x\n');
    await commit(repo, 'feat: yerel', { addAll: true });
    const before = await head(repo);

    expect((await pull(repo)).ok).toBe(false);
    expect(await head(repo)).toBe(before);
    expect((await statusOf(repo)).files).toEqual([]);
  });

  it('fetch sonrası geride kalınan commit sayısı görünür', async () => {
    const { repo, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'uzak.txt');
    expect((await statusOf(repo)).behind).toBe(0);

    expect(await fetchRepo(repo)).toEqual({ ok: true, message: 'fetch edildi' });
    expect((await statusOf(repo)).behind).toBe(1);
  });
});

describe('branch', () => {
  it('yerel branch\'leri ve geçerli olanı listeler', async () => {
    const repo = await newRepo();
    await git(repo, 'branch', 'feat/x');
    expect(await listBranches(repo)).toEqual({ ok: true, branches: ['feat/x', 'main'], current: 'main' });
  });

  it('detached HEAD\'de geçerli branch yoktur', async () => {
    const repo = await newRepo();
    await git(repo, 'checkout', '-q', '--detach');
    expect(await listBranches(repo)).toEqual({ ok: true, branches: ['main'], current: null });
  });

  it('var olan branch\'e geçer ve yenisini açar', async () => {
    const repo = await newRepo();
    await git(repo, 'branch', 'feat/x');

    expect(await switchBranch(repo, 'feat/x')).toEqual({ ok: true, message: "feat/x branch'ine geçildi" });
    expect((await statusOf(repo)).head).toBe('feat/x');

    expect((await createBranch(repo, 'fix/y')).ok).toBe(true);
    expect((await statusOf(repo)).head).toBe('fix/y');
  });

  it('çakışan yerel değişiklik varken geçiş reddedilir, değişiklik korunur', async () => {
    const repo = await newRepo();
    await git(repo, 'switch', '-q', '-c', 'feat/x');
    await write(repo, 'README.md', 'feat/x içeriği\n');
    await git(repo, 'commit', '-q', '-am', 'feat: x');
    await git(repo, 'switch', '-q', 'main');
    await write(repo, 'README.md', 'kaydedilmemiş yerel değişiklik\n');

    expect((await switchBranch(repo, 'feat/x')).ok).toBe(false);
    expect((await statusOf(repo)).head).toBe('main');
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('kaydedilmemiş yerel değişiklik\n');
  });

  it('geçersiz branch adı hata döner', async () => {
    const repo = await newRepo();
    expect((await createBranch(repo, 'kötü ad')).ok).toBe(false);
    expect((await statusOf(repo)).head).toBe('main');
  });
});

describe('diff', () => {
  it("değişen dosyada stage'li ve stage'siz değişiklikleri birlikte verir", async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'readme\nstage satırı\n');
    await git(repo, 'add', '-A');
    await write(repo, 'README.md', 'readme\nstage satırı\nyeni satır\n');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'README.md'));
    expect(r.ok && r.text).toContain('+stage satırı');
    expect(r.ok && r.text).toContain('+yeni satır');
  });

  it('yeni dosyanın tamamını ekleme olarak verir, yolu kaçışsız yazar', async () => {
    const repo = await newRepo();
    await write(repo, 'boş dosya.txt', 'içerik\n');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'boş dosya.txt'));
    expect(r.ok && r.text).toContain('+++ b/boş dosya.txt');
    expect(r.ok && r.text).toContain('+içerik');
  });

  it("commit'i olmayan repoda stage'li dosyanın diff'ini verir", async () => {
    const repo = await newRepo({});
    await write(repo, 'ilk.txt', 'ilk satır\n');
    await git(repo, 'add', '-A');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'ilk.txt'));
    expect(r.ok && r.text).toContain('+ilk satır');
  });

  it("stage'li rename'i rename olarak gösterir", async () => {
    const repo = await newRepo();
    await git(repo, 'mv', 'README.md', 'OKU.md');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'OKU.md'));
    expect(r.ok && r.text).toContain('rename from README.md');
  });

  it('repo diff\'i izlenen ve yeni dosyaları birlikte verir', async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'readme\nyeni satır\n');
    await write(repo, 'unt.txt', 'yeni dosya\n');

    const r = await diffRepo(repo, await statusOf(repo));
    expect(r.ok && r.text).toContain('+yeni satır');
    expect(r.ok && r.text).toContain('+++ b/unt.txt');
    expect(r.ok && r.text).toContain('+yeni dosya');
  });

  it('temiz repoda boş metin döner', async () => {
    const repo = await newRepo();
    expect(await diffRepo(repo, await statusOf(repo))).toEqual({ ok: true, text: '' });
  });

  it('renk ve harici diff aracı ayarlıyken düz metin verir', async () => {
    const repo = await newRepo();
    await git(repo, 'config', 'color.ui', 'always');
    await git(repo, 'config', 'diff.external', '/usr/bin/false');
    await write(repo, 'README.md', 'readme\nyeni satır\n');
    await write(repo, 'unt.txt', 'yeni dosya\n');

    const r = await diffRepo(repo, await statusOf(repo));
    expect(r.ok && r.text).toContain('+yeni satır');
    expect(r.ok && r.text).not.toContain('\u001B[');
  });
});
