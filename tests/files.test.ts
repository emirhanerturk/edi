import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, listFiles, readRepoFile, resolveInRepo } from '../src/git/files.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);

async function repoWithOutside() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', { commit: true });
  await writeFile(join(dir, 'outside.txt'), 'gizli\n');
  await mkdir(join(dir, 'outside-dir'));
  await writeFile(join(dir, 'outside-dir', 'x.txt'), 'gizli\n');
  return { dir, repo };
}

describe('listFiles', () => {
  it('izlenen ve yeni dosyaları listeler; yok sayılanları ve silinenleri listelemez', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, '.gitignore'), 'node_modules/\n*.log\n');
    await mkdir(join(repo, 'src', 'deep'), { recursive: true });
    await mkdir(join(repo, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'x\n');
    await writeFile(join(repo, 'src', 'deep', 'b.ts'), 'x\n');
    await writeFile(join(repo, 'node_modules', 'x', 'index.js'), 'x\n');
    await writeFile(join(repo, 'debug.log'), 'x\n');
    await git(repo, 'add', 'src/a.ts');
    await writeFile(join(repo, 'silinecek.txt'), 'x\n');
    await git(repo, 'add', 'silinecek.txt');
    await git(repo, 'commit', '-q', '-m', 'feat: x');
    await rm(join(repo, 'silinecek.txt'));

    expect(await listFiles(repo)).toEqual({ ok: true, files: ['.gitignore', 'README.md', 'src/a.ts', 'src/deep/b.ts'] });
  });

  it('boşluklu, Türkçe karakterli ve tireyle başlayan adları olduğu gibi verir', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'boş dosya.txt'), 'x\n');
    await writeFile(join(repo, '-tire.txt'), 'x\n');
    await writeFile(join(repo, 'çığ.md'), 'x\n');
    const result = await listFiles(repo);
    expect(result.ok && result.files).toEqual(['-tire.txt', 'README.md', 'boş dosya.txt', 'çığ.md']);
  });

  it("commit'i olmayan repoda çalışır", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await writeFile(join(repo, 'ilk.txt'), 'x\n');
    expect(await listFiles(repo)).toEqual({ ok: true, files: ['ilk.txt'] });
  });

  it('repo olmayan klasörde hata döner', async () => {
    expect((await listFiles(await makeTmpDir())).ok).toBe(false);
  });
});

describe('readRepoFile', () => {
  it('metin dosyasını okur', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'çığ dosya.ts'), 'const a = 1;\n');
    expect(await readRepoFile(repo, 'src/çığ dosya.ts')).toEqual({ ok: true, kind: 'text', text: 'const a = 1;\n', size: 13 });
    expect(await readRepoFile(repo, 'README.md')).toMatchObject({ kind: 'text', text: 'readme\n' });
  });

  it('boş dosya boş metindir', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'bos.txt'), '');
    expect(await readRepoFile(repo, 'bos.txt')).toEqual({ ok: true, kind: 'text', text: '', size: 0 });
  });

  it("1 MB'a kadar okur, bir bayt fazlasını göndermez", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'tam.txt'), 'a'.repeat(MAX_FILE_BYTES));
    await writeFile(join(repo, 'fazla.txt'), 'a'.repeat(MAX_FILE_BYTES + 1));
    const exact = await readRepoFile(repo, 'tam.txt');
    expect(exact).toMatchObject({ ok: true, kind: 'text', size: MAX_FILE_BYTES });
    expect(await readRepoFile(repo, 'fazla.txt')).toEqual({ ok: true, kind: 'tooLarge', size: MAX_FILE_BYTES + 1 });
  });

  it('ikili dosyanın içeriğini göndermez', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'resim.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
    expect(await readRepoFile(repo, 'resim.png')).toEqual({ ok: true, kind: 'binary', size: 12 });
  });

  it('klasör ve olmayan dosya için anlaşılır hata', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'src'));
    expect(await readRepoFile(repo, 'src')).toEqual({ ok: false, error: 'Not a file' });
    expect(await readRepoFile(repo, 'yok.txt')).toEqual({ ok: false, error: 'File not found' });
  });

  it('repo dışına çıkan her yol okunmadan reddedilir', async () => {
    const { dir, repo } = await repoWithOutside();
    await symlink('../outside.txt', join(repo, 'link.txt'));
    await symlink('../outside-dir', join(repo, 'linkdir'));
    await symlink(join(dir, 'outside.txt'), join(repo, 'abslink.txt'));
    await mkdir(join(repo, 'a'));
    const outside = { ok: false, error: 'File is outside the repository' };

    for (const path of [
      '../outside.txt',
      'a/../../outside.txt',
      './../outside.txt',
      join(dir, 'outside.txt'),
      '/etc/hosts',
      'link.txt',
      'abslink.txt',
      'linkdir/x.txt',
      '.git/config',
      '.git/HEAD',
      'a/../.git/config',
      '',
      'README.md\0.txt',
      '..',
    ]) {
      expect(await readRepoFile(repo, path), JSON.stringify(path)).toEqual(outside);
      expect(await resolveInRepo(repo, path), JSON.stringify(path)).toBeNull();
    }
  });

  it('repo içindeki bir dosyayı gösteren sembolik bağ okunur', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await symlink('README.md', join(repo, 'OKU.md'));
    expect(await readRepoFile(repo, 'OKU.md')).toMatchObject({ ok: true, kind: 'text', text: 'readme\n' });
  });

  it("iç içe reponun .git klasörü de okunmaz; dışarıdan bağ ile de", async () => {
    const { repo } = await repoWithOutside();
    const nested = await initRepo(join(repo, 'vendor'), 'tool', { commit: true });
    await symlink(join(nested, '.git'), join(repo, 'bag'));
    for (const path of ['vendor/tool/.git/config', 'vendor/tool/.GIT/config', 'vendor/tool/.git', 'bag/config']) {
      expect(await readRepoFile(repo, path), path).toEqual({ ok: false, error: 'File is outside the repository' });
      expect(await resolveInRepo(repo, path), path).toBeNull();
    }
  });

  it('adı .. ile başlayan dosya repo dışı sayılmaz', async () => {
    const { repo } = await repoWithOutside();
    await writeFile(join(repo, '..notlar'), 'x\n');
    expect(await readRepoFile(repo, '..notlar')).toMatchObject({ ok: true, kind: 'text', text: 'x\n' });
  });

  it('FIFO açılmadan reddedilir (okuyan beklemez)', async () => {
    const { repo } = await repoWithOutside();
    await run('mkfifo', [join(repo, 'boru')]);
    await symlink('boru', join(repo, 'bag'));
    for (const path of ['boru', 'bag']) {
      const result = await Promise.race([readRepoFile(repo, path), new Promise((done) => setTimeout(() => done('takıldı'), 1000))]);
      expect(result, path).toEqual({ ok: false, error: 'Not a file' });
    }
  });

  it('.git ile başlayan ama .git olmayan adlar serbesttir', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, '.github'));
    await writeFile(join(repo, '.github', 'ci.yml'), 'on: push\n');
    await writeFile(join(repo, '.gitignore'), 'x\n');
    expect(await readRepoFile(repo, '.github/ci.yml')).toMatchObject({ kind: 'text' });
    expect(await readRepoFile(repo, '.gitignore')).toMatchObject({ kind: 'text' });
  });
});
