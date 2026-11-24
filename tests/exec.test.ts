import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickErrorLine, runGit } from '../src/git/exec.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

describe('runGit', () => {
  it('başarıda stdout döner', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    expect(await runGit(repo, ['rev-parse', '--is-inside-work-tree'])).toEqual({ ok: true, stdout: 'true\n' });
  });

  it('repo olmayan dizinde git hatasını döner', async () => {
    const r = await runGit(await makeTmpDir(), ['status']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^fatal:/);
  });

  it('git çıktısı yerel ayardan bağımsız İngilizce', async () => {
    const before = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
    process.env.LANG = 'tr_TR.UTF-8';
    process.env.LC_ALL = 'tr_TR.UTF-8';
    try {
      const env = await runGit(await makeTmpDir(), ['-c', 'alias.env=!env', 'env']);
      expect(env.ok && env.stdout).toMatch(/^LC_ALL=C$/m);
      expect(env.ok && env.stdout).toMatch(/^LANG=C$/m);
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('olmayan cwd ile throw etmez', async () => {
    expect((await runGit('/yok/boyle/yer', ['status'])).ok).toBe(false);
  });

  it('okCodes içindeki çıkış kodunu başarı sayar', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const args = ['diff', '--no-index', '--', '/dev/null', 'README.md'];
    expect((await runGit(repo, args)).ok).toBe(false);
    expect((await runGit(repo, args, { okCodes: [0, 1] })).ok).toBe(true);
  });

  it("git hatayı stdout'a yazdığında onu döner", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const r = await runGit(repo, ['commit', '-m', 'feat: boş']);
    expect(!r.ok && r.error).toMatch(/nothing to commit/);
  });

  it('zaman aşımında süreci keser', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const started = Date.now();
    // Sonsuza dek bekleyen bir alias: runGit onu kesmek zorunda.
    const r = await runGit(repo, ['-c', 'alias.bekle=!sleep 30', 'bekle'], { timeoutMs: 200 });
    expect(r).toMatchObject({ ok: false, error: 'Timed out' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('runGit sağlamlığı', () => {
  it('silinmiş repo klasöründe anlaşılır hata', async () => {
    const r = await runGit(join(await makeTmpDir(), 'gone'), ['status']);
    expect(r).toEqual({ ok: false, error: 'Repository folder not found', stdout: '' });
  });

  it('arka plana süreç atan hook zaman aşımı sayılmaz', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const hook = join(repo, '.git', 'hooks', 'post-commit');
    await writeFile(hook, '#!/bin/sh\n(sleep 6) &\n');
    await chmod(hook, 0o755);
    await writeFile(join(repo, 'README.md'), 'değişti\n');

    const started = Date.now();
    const r = await runGit(repo, ['commit', '-am', 'feat: x'], { timeoutMs: 4000 });
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('feat: x\n');
  });

  it('zaman aşımında kilit dosyası ve alt süreç bırakmaz', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    const pidFile = join(repo, '.git', 'hook.pid');
    await writeFile(hook, `#!/bin/sh\necho $$ > "${pidFile}"\nsleep 30\n`);
    await chmod(hook, 0o755);
    await writeFile(join(repo, 'README.md'), 'değişti\n');

    // commit -a hook çalışırken index.lock'u tutar.
    const r = await runGit(repo, ['commit', '-a', '-m', 'feat: x'], { timeoutMs: 1500 });
    expect(r).toMatchObject({ ok: false, error: 'Timed out' });

    const lockExists = await access(join(repo, '.git', 'index.lock')).then(() => true, () => false);
    expect(lockExists).toBe(false);
    const hookPid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(() => process.kill(hookPid, 0)).toThrow(); // hook süreci de bitmiş
    expect((await git(repo, 'rev-list', '--count', 'HEAD')).trim()).toBe('1');
  });

  it('NUL içeren argümanda reject etmez', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await expect(runGit(repo, ['commit', '-m', 'a\0b'])).resolves.toMatchObject({ ok: false });
  });

  it('ortamdan gelen GIT_DIR başka repoya yönlendiremez', async () => {
    const parent = await makeTmpDir();
    const repoA = await initRepo(parent, 'a', { commit: true });
    const repoB = await initRepo(parent, 'b', { commit: true });
    process.env.GIT_DIR = join(repoB, '.git');
    try {
      const r = await runGit(repoA, ['rev-parse', '--absolute-git-dir']);
      expect(r).toEqual({ ok: true, stdout: `${join(repoA, '.git')}\n` });
    } finally {
      delete process.env.GIT_DIR;
    }
  });
});

describe('pickErrorLine', () => {
  it('fatal/error satırını ipucu satırlarına tercih eder', () => {
    expect(pickErrorLine('hint: x\nerror: failed to push some refs\n')).toBe('error: failed to push some refs');
  });
  it('reddedilen push satırını seçer', () => {
    expect(pickErrorLine(' ! [rejected] main -> main (fetch first)\nerror: failed\n')).toBe(
      '! [rejected] main -> main (fetch first)',
    );
  });
  it('eşleşme yoksa son dolu satırı verir', () => {
    expect(pickErrorLine('foo\nbar\n')).toBe('bar');
  });
  it('boş çıktıda genel bir mesaj verir', () => {
    expect(pickErrorLine('')).toBe('git failed');
  });
});
