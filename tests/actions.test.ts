import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commit,
  createBranch,
  diffFile,
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
const write = async (repo: string, path: string, content: string) => {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), content);
};
const exists = (path: string) => access(path).then(() => true, () => false);

/** README.md'de çözülmemiş çakışması olan, merge'ü yarıda kalmış repo. */
async function repoWithConflict() {
  const repo = await newRepo();
  await git(repo, 'switch', '-q', '-c', 'feat/x');
  await write(repo, 'README.md', 'feat/x satırı\n');
  await git(repo, 'commit', '-q', '-am', 'feat: x');
  await git(repo, 'switch', '-q', 'main');
  await write(repo, 'README.md', 'main satırı\n');
  await git(repo, 'commit', '-q', '-am', 'feat: main');
  await git(repo, 'merge', 'feat/x').catch(() => undefined); // çakışmayla biter
  return repo;
}

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

    expect(await stageFile(repo, await fileOf(repo, 'boş dosya.txt'))).toEqual({ ok: true, message: 'Staged' });
    expect(await fileOf(repo, 'boş dosya.txt')).toMatchObject({ x: 'A', y: '.' });

    expect(await unstageFile(repo, await fileOf(repo, 'boş dosya.txt'))).toEqual({
      ok: true,
      message: 'Unstaged',
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

    expect(await commit(repo, 'feat: x', { addAll: false })).toEqual({ ok: true, message: 'Committed' });
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

    expect(await commit(repo, '   ', { addAll: false })).toEqual({ ok: false, error: 'Commit message is empty' });
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

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: true, message: 'Pushed' });
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
    expect(await push(repo, await statusOf(repo))).toEqual({ ok: false, error: 'Detached HEAD: cannot push' });
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

    expect(await pull(repo)).toEqual({ ok: true, message: 'Pulled' });
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

    expect(await fetchRepo(repo)).toEqual({ ok: true, message: 'Fetched' });
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

    expect(await switchBranch(repo, 'feat/x')).toEqual({ ok: true, message: 'Switched to feat/x' });
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

  it('renk ve harici diff aracı ayarlıyken düz metin verir', async () => {
    const repo = await newRepo();
    await git(repo, 'config', 'color.ui', 'always');
    await git(repo, 'config', 'diff.external', '/usr/bin/false');
    await write(repo, 'README.md', 'readme\nyeni satır\n');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'README.md'));
    expect(r.ok && r.text).toContain('+yeni satır');
    expect(r.ok && r.text).not.toContain('\u001B[');
  });
});

describe('inceleme bulguları', () => {
  it('unstageAll yarıda kalmış merge durumunu silmez', async () => {
    const repo = await newRepo();
    await git(repo, 'switch', '-q', '-c', 'feat/x');
    await write(repo, 'a.txt', 'x\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: a');
    await git(repo, 'switch', '-q', 'main');
    await write(repo, 'b.txt', 'x\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: b');
    await git(repo, 'merge', '--no-commit', '--no-ff', 'feat/x');
    expect(await exists(join(repo, '.git', 'MERGE_HEAD'))).toBe(true);

    expect((await unstageAll(repo)).ok).toBe(true);
    expect((await statusOf(repo)).files.some(isStaged)).toBe(false);
    expect(await exists(join(repo, '.git', 'MERGE_HEAD'))).toBe(true);
  });

  it('.git klasörü geçersiz olan satır üst klasördeki repoda işlem yapmaz', async () => {
    const outer = await newRepo();
    await write(outer, 'gizli.env', 'x\n');
    const inner = join(outer, 'inner');
    await mkdir(join(inner, '.git'), { recursive: true }); // boş .git: repo değil

    expect((await getStatus(inner)).ok).toBe(false);
    expect((await stageAll(inner)).ok).toBe(false);
    expect((await commit(inner, 'feat: x', { addAll: true })).ok).toBe(false);
    expect((await statusOf(outer)).files.some(isStaged)).toBe(false);
    expect(await commitCount(outer)).toBe(1);
  });

  it('köşeli parantezli yol başka dosyalarla eşleşmez', async () => {
    const repo = await newRepo();
    await write(repo, 'app/[slug]/page.tsx', 'a\n');
    await write(repo, 'app/u/page.tsx', 'a\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: sayfalar');
    await write(repo, 'app/[slug]/page.tsx', 'a\nslug değişti\n');
    await write(repo, 'app/u/page.tsx', 'a\nu değişti\n');

    const diff = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'app/[slug]/page.tsx'));
    expect(diff.ok && diff.text).toContain('+slug değişti');
    expect(diff.ok && diff.text).not.toContain('u değişti');

    expect((await stageFile(repo, await fileOf(repo, 'app/[slug]/page.tsx'))).ok).toBe(true);
    expect(await fileOf(repo, 'app/[slug]/page.tsx')).toMatchObject({ x: 'M', y: '.' });
    expect(await fileOf(repo, 'app/u/page.tsx')).toMatchObject({ x: '.', y: 'M' });
  });

  it('yıldızlı ve iki noktayla başlayan dosya adları yalnız kendilerini stage eder', async () => {
    const repo = await newRepo();
    await write(repo, '*.txt', 'x\n');
    await write(repo, 'other.txt', 'x\n');
    await write(repo, ':colon.txt', 'x\n');

    expect((await stageFile(repo, await fileOf(repo, '*.txt'))).ok).toBe(true);
    expect(await fileOf(repo, 'other.txt')).toMatchObject({ kind: 'untracked' });
    expect((await stageFile(repo, await fileOf(repo, ':colon.txt'))).ok).toBe(true);
    expect(await fileOf(repo, ':colon.txt')).toMatchObject({ x: 'A' });

    expect((await unstageFile(repo, await fileOf(repo, '*.txt'))).ok).toBe(true);
    expect(await fileOf(repo, ':colon.txt')).toMatchObject({ x: 'A' });
  });

  it('çakışmalı dosya varken stageAll reddeder, çakışma çözülmüş sayılmaz', async () => {
    const repo = await repoWithConflict();
    expect(await stageAll(repo)).toEqual({ ok: false, error: 'Conflicted files present; resolve them outside edi' });
    expect(await fileOf(repo, 'README.md')).toMatchObject({ kind: 'conflicted' });
  });

  it('çakışmalı dosya varken tümünü commit etme reddedilir', async () => {
    const repo = await repoWithConflict();
    const before = await commitCount(repo);
    expect(await commit(repo, 'feat: x', { addAll: true })).toEqual({
      ok: false,
      error: 'Conflicted files present; resolve them outside edi',
    });
    expect(await commitCount(repo)).toBe(before);
    expect(await fileOf(repo, 'README.md')).toMatchObject({ kind: 'conflicted' });
  });
});

describe('ertelenen bulgular', () => {
  it('etiketle aynı adlı branch kısa adıyla listelenir', async () => {
    const repo = await newRepo();
    await git(repo, 'tag', 'release');
    await git(repo, 'switch', '-q', '-c', 'release');
    expect(await listBranches(repo)).toEqual({ ok: true, branches: ['main', 'release'], current: 'release' });
  });

  it("upstream'i silinmiş branch'te push branch'i yeniden yayınlar", async () => {
    const repo = await newRepo();
    await addBareRemote(repo);
    await git(repo, 'switch', '-q', '-c', 'feat');
    await git(repo, 'push', '-q', '-u', 'origin', 'feat');
    await git(repo, 'push', '-q', 'origin', '--delete', 'feat');
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'feat: a', { addAll: true });
    expect(await statusOf(repo)).toMatchObject({ upstream: 'origin/feat', ahead: null });

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: true, message: 'Pushed' });
    expect((await git(repo, 'ls-remote', 'origin', 'refs/heads/feat')).split('\t')[0]).toBe(await head(repo));
    expect(await statusOf(repo)).toMatchObject({ upstream: 'origin/feat', ahead: 0 });
  });

  it('etiketle aynı adlı yeni branch push edilir', async () => {
    const repo = await newRepo();
    await addBareRemote(repo);
    await git(repo, 'tag', 'v1');
    await git(repo, 'switch', '-q', '-c', 'v1');

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: true, message: 'Pushed' });
    expect((await git(repo, 'ls-remote', 'origin', 'refs/heads/v1')).split('\t')[0]).toBe(await head(repo));
    expect(await git(repo, 'ls-remote', 'origin', 'refs/tags/v1')).toBe('');
  });

  it('çok satırlı, tireyle başlayan ve özel karakterli mesaj aynen commit edilir', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    const message = '-m fix: x\n\nbody with "quotes", `ticks` and $(touch pwned)\n# kare ile başlayan satır\n--amend';

    expect(await commit(repo, `${message}\n\n  `, { addAll: true })).toEqual({ ok: true, message: 'Committed' });
    expect(await git(repo, 'log', '-1', '--format=%B')).toBe(`${message}\n\n`);
    expect(await exists(join(repo, 'pwned'))).toBe(false);
    expect(await commitCount(repo)).toBe(2); // --amend seçenek olarak yorumlanmadı
  });

  it('tire ile başlayan branch adı reddedilir', async () => {
    const repo = await newRepo();
    const invalid = { ok: false, error: 'Invalid branch name' };
    expect(await switchBranch(repo, '--detach')).toEqual(invalid);
    expect(await createBranch(repo, '-x')).toEqual(invalid);
    expect(await switchBranch(repo, '')).toEqual(invalid);
    expect(await createBranch(repo, '   ')).toEqual(invalid);
    expect((await git(repo, 'symbolic-ref', 'HEAD')).trim()).toBe('refs/heads/main');
  });

  it('çakışmalı dosya varken unstageAll reddeder; çakışma kaydı silinmez', async () => {
    const repo = await repoWithConflict();
    // Çakışmanın yanında temiz birleşmiş, stage'li bir dosya da olsun.
    await write(repo, 'temiz.txt', 'x\n');
    await git(repo, 'add', '--', 'temiz.txt');

    expect(await unstageAll(repo)).toEqual({ ok: false, error: 'Conflicted files present; resolve them outside edi' });
    expect(await fileOf(repo, 'README.md')).toMatchObject({ kind: 'conflicted' });
    expect(await fileOf(repo, 'temiz.txt')).toMatchObject({ x: 'A' });
  });

  it('hiçbir şey stage\'li değilken başarısız olan "tümünü commit et" index\'i eski hâline döndürür', async () => {
    const repo = await newRepo();
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'README.md', 'bozuk\n');
    await write(repo, 'yeni.txt', 'x\n');

    const result = await commit(repo, 'feat: x', { addAll: true });
    expect(result.ok).toBe(false);
    expect(await commitCount(repo)).toBe(1);
    // Düzeltilen dosyanın eski hâli index'te kalıp sonraki commit'e sessizce girmesin.
    expect((await statusOf(repo)).files.some(isStaged)).toBe(false);
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('bozuk\n'); // çalışma ağacına dokunulmaz
    expect(await fileOf(repo, 'yeni.txt')).toMatchObject({ kind: 'untracked' });
  });

  it('önceden stage\'li dosya varken başarısız olan commit index\'e dokunmaz', async () => {
    const repo = await newRepo();
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'README.md', 'değişti\n');
    await git(repo, 'add', '--', 'README.md');
    await write(repo, 'yeni.txt', 'x\n');

    expect((await commit(repo, 'feat: x', { addAll: false })).ok).toBe(false);
    expect(await fileOf(repo, 'README.md')).toMatchObject({ x: 'M', y: '.' });
    expect(await fileOf(repo, 'yeni.txt')).toMatchObject({ kind: 'untracked' });
  });

  it('commit\'siz repoda başarısız olan "tümünü commit et" de index\'i boşaltır', async () => {
    const repo = await newRepo({ commit: false });
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'ilk.txt', 'x\n');

    expect((await commit(repo, 'feat: x', { addAll: true })).ok).toBe(false);
    expect(await fileOf(repo, 'ilk.txt')).toMatchObject({ kind: 'untracked' });
  });
});
