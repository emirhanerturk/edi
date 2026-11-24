import { describe, expect, it } from 'vitest';
import { pickErrorLine, runGit } from '../src/git/exec.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

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

  it('olmayan cwd ile throw etmez', async () => {
    expect((await runGit('/yok/boyle/yer', ['status'])).ok).toBe(false);
  });

  it('okCodes içindeki çıkış kodunu başarı sayar', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const args = ['diff', '--no-index', '--', '/dev/null', 'README.md'];
    expect((await runGit(repo, args)).ok).toBe(false);
    expect((await runGit(repo, args, { okCodes: [0, 1] })).ok).toBe(true);
  });

  it('zaman aşımında süreci keser', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const started = Date.now();
    // Sonsuza dek bekleyen bir alias: runGit onu kesmek zorunda.
    const r = await runGit(repo, ['-c', 'alias.bekle=!sleep 30', 'bekle'], { timeoutMs: 200 });
    expect(r).toMatchObject({ ok: false, error: 'zaman aşımı' });
    expect(Date.now() - started).toBeLessThan(5000);
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
    expect(pickErrorLine('')).toBe('git başarısız oldu');
  });
});
