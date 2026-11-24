import { execFile } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readCommit, splitPatch } from '../src/git/commit.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);
const head = async (repo: string) => (await git(repo, 'rev-parse', 'HEAD')).trim();

async function commitAll(repo: string, message: string[]): Promise<string> {
  await git(repo, 'add', '-A');
  await run('git', ['commit', '-q', ...message.flatMap((m) => ['-m', m])], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: '@1700000000 +0000', GIT_COMMITTER_DATE: '@1700000000 +0000' },
  });
  return head(repo);
}

describe('splitPatch', () => {
  it('her "diff --git" başlığında yeni parça başlar', () => {
    const patch = ['diff --git a/a b/a', '@@ -1 +1 @@', '-x', '+y', 'diff --git a/b b/b', 'new file mode 100644', '@@ -0,0 +1 @@', '+z', ''].join('\n');
    expect(splitPatch(patch)).toEqual([
      'diff --git a/a b/a\n@@ -1 +1 @@\n-x\n+y\n',
      'diff --git a/b b/b\nnew file mode 100644\n@@ -0,0 +1 @@\n+z\n',
    ]);
  });

  it('içeriği "diff --git" olan satır yeni parça başlatmaz', () => {
    const patch = ['diff --git a/a b/a', '@@ -1,2 +1,2 @@', ' diff --git x y', '-x', '+diff --git a b', ''].join('\n');
    expect(splitPatch(patch)).toHaveLength(1);
  });

  it('boş metinde parça yok', () => {
    expect(splitPatch('')).toEqual([]);
  });
});

describe('readCommit', () => {
  it('başlık, çok satırlı gövde, dosyalar ve toplamlar', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'README.md'), 'readme\nikinci\n');
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'yeni.ts'), 'const a = 1;\nconst b = 2;\n');
    const oid = await commitAll(repo, ['feat(app): add the thing', 'İlk paragraf.\nAynı paragraf.', 'İkinci paragraf.']);

    const result = await readCommit(repo, oid);
    if (!result.ok) throw new Error(result.error);
    const { commit } = result;
    expect(commit).toMatchObject({
      oid,
      short: oid.slice(0, 7),
      subject: 'feat(app): add the thing',
      body: 'İlk paragraf.\nAynı paragraf.\n\nİkinci paragraf.',
      authorName: 'Test',
      authorEmail: 'test@example.com',
      date: 1_700_000_000_000,
      parents: 1,
      added: 3,
      removed: 0,
    });
    expect(commit.files.map((f) => [f.letter, f.path, f.origPath, f.diff.added, f.diff.removed])).toEqual([
      ['M', 'README.md', null, 1, 0],
      ['A', 'src/yeni.ts', null, 2, 0],
    ]);
    expect(commit.files[1]!.diff.hunks[0]!.lines[0]).toEqual({ kind: 'add', newNo: 1, text: 'const a = 1;' });
  });

  it('kök commit: her şey eklenmiş', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const result = await readCommit(repo, await head(repo));
    expect(result.ok && result.commit.files.map((f) => [f.letter, f.path, f.diff.added])).toEqual([['A', 'README.md', 1]]);
    expect(result.ok && result.commit.parents).toBe(0);
  });

  it("merge commit'i ilk ebeveynine göre gösterilir", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await git(repo, 'switch', '-q', '-c', 'yan');
    await writeFile(join(repo, 'yan.txt'), 'yan\n');
    await commitAll(repo, ['feat: yan']);
    await git(repo, 'switch', '-q', 'main');
    await writeFile(join(repo, 'ana.txt'), 'ana\n');
    await commitAll(repo, ['feat: ana']);
    await git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge yan', 'yan');

    const result = await readCommit(repo, await head(repo));
    expect(result.ok && result.commit.parents).toBe(2);
    expect(result.ok && result.commit.files.map((f) => f.path)).toEqual(['yan.txt']);
  });

  it('yeniden adlandırma, silme, yalnız izin değişikliği ve ikili dosya', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'uzun.txt'), Array.from({ length: 20 }, (_, i) => `satır ${i}`).join('\n') + '\n');
    await writeFile(join(repo, 'silinecek.txt'), 'x\n');
    await writeFile(join(repo, 'betik.sh'), 'echo x\n');
    await commitAll(repo, ['chore: hazırlık']);

    await git(repo, 'mv', 'uzun.txt', 'yeni-ad.txt');
    await writeFile(join(repo, 'yeni-ad.txt'), Array.from({ length: 20 }, (_, i) => (i === 3 ? 'değişti' : `satır ${i}`)).join('\n') + '\n');
    await rm(join(repo, 'silinecek.txt'));
    await chmod(join(repo, 'betik.sh'), 0o755);
    await writeFile(join(repo, 'resim.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
    const oid = await commitAll(repo, ['refactor: karışık']);

    const result = await readCommit(repo, oid);
    if (!result.ok) throw new Error(result.error);
    const byPath = Object.fromEntries(result.commit.files.map((f) => [f.path, f]));
    expect(byPath['yeni-ad.txt']).toMatchObject({ letter: 'R', origPath: 'uzun.txt', diff: { added: 1, removed: 1 } });
    expect(byPath['silinecek.txt']).toMatchObject({ letter: 'D', diff: { added: 0, removed: 1 } });
    expect(byPath['betik.sh']).toMatchObject({ letter: 'M', diff: { hunks: [], added: 0, removed: 0 } });
    expect(byPath['resim.png']).toMatchObject({ letter: 'A', diff: { binary: true } });
    expect(result.commit.files).toHaveLength(4);
  });

  it('boşluklu, Türkçe ve tireyle başlayan yollar', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'boş klasör'));
    await writeFile(join(repo, 'boş klasör', '-tuhaf ö.txt'), 'bir\n');
    const result = await readCommit(repo, await commitAll(repo, ['feat: tuhaf']));
    expect(result.ok && result.commit.files.map((f) => [f.path, f.diff.added])).toEqual([['boş klasör/-tuhaf ö.txt', 1]]);
  });

  it('boş konu satırı ve dosyasız commit', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await git(repo, 'commit', '-q', '--allow-empty', '--allow-empty-message', '-m', '');
    const result = await readCommit(repo, await head(repo));
    expect(result).toMatchObject({ ok: true, commit: { subject: '', body: '', files: [], added: 0, removed: 0 } });
  });

  it('kullanıcının diff ayarları sonucu değiştirmez', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, '.gitattributes'), '*.txt diff=sabit\n');
    await writeFile(join(repo, 'a.txt'), 'eski\n');
    await commitAll(repo, ['chore: a']);
    await writeFile(join(repo, 'a.txt'), 'yeni\n');
    const oid = await commitAll(repo, ['fix: a']);
    for (const [key, value] of [
      ['diff.noprefix', 'true'],
      ['diff.mnemonicPrefix', 'true'],
      ['diff.external', 'false'],
      ['color.ui', 'always'],
      ['diff.renames', 'false'],
      ['diff.sabit.textconv', "sh -c 'echo aynı'"],
      ['log.showSignature', 'true'],
    ] as const) {
      await git(repo, 'config', key, value);
    }
    const result = await readCommit(repo, oid);
    expect(result.ok && result.commit.files.map((f) => [f.path, f.diff.added, f.diff.removed])).toEqual([['a.txt', 1, 1]]);
    expect(result.ok && result.commit.subject).toBe('fix: a');
  });
});
