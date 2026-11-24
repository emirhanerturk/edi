import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickErrorLine, runGit } from '../src/git/exec.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

describe('runGit', () => {
  it('returns stdout on success', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    expect(await runGit(repo, ['rev-parse', '--is-inside-work-tree'])).toEqual({ ok: true, stdout: 'true\n' });
  });

  it('passes `input` on stdin', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    expect(await runGit(repo, ['hash-object', '--stdin'], { input: 'hello\n' })).toEqual({ ok: true, stdout: 'ce013625030ba8dba906f756967f9e9ca394464a\n' });
  });

  it("returns git's error in a directory that is not a repo", async () => {
    const r = await runGit(await makeTmpDir(), ['status']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^fatal:/);
  });

  it('keeps git output in English regardless of the locale', async () => {
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

  it('does not throw with a missing cwd', async () => {
    expect((await runGit('/no/such/place', ['status'])).ok).toBe(false);
  });

  it('treats an exit code listed in okCodes as success', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const args = ['diff', '--no-index', '--', '/dev/null', 'README.md'];
    expect((await runGit(repo, args)).ok).toBe(false);
    expect((await runGit(repo, args, { okCodes: [0, 1] })).ok).toBe(true);
  });

  it('returns the error when git writes it to stdout', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const r = await runGit(repo, ['commit', '-m', 'feat: empty']);
    expect(!r.ok && r.error).toMatch(/nothing to commit/);
  });

  it('kills the process on timeout', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const started = Date.now();
    // An alias that waits forever: runGit has to kill it.
    const r = await runGit(repo, ['-c', 'alias.hang=!sleep 30', 'hang'], { timeoutMs: 200 });
    expect(r).toMatchObject({ ok: false, error: 'Timed out' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('runGit robustness', () => {
  it('gives a clear error for a deleted repo folder', async () => {
    const r = await runGit(join(await makeTmpDir(), 'gone'), ['status']);
    expect(r).toEqual({ ok: false, error: 'Repository folder not found', stdout: '' });
  });

  it('does not time out on a hook that leaves a background process', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const hook = join(repo, '.git', 'hooks', 'post-commit');
    await writeFile(hook, '#!/bin/sh\n(sleep 6) &\n');
    await chmod(hook, 0o755);
    await writeFile(join(repo, 'README.md'), 'changed\n');

    const started = Date.now();
    const r = await runGit(repo, ['commit', '-am', 'feat: x'], { timeoutMs: 4000 });
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('feat: x\n');
  });

  it('leaves no lock file or child process behind on timeout', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    const pidFile = join(repo, '.git', 'hook.pid');
    await writeFile(hook, `#!/bin/sh\necho $$ > "${pidFile}"\nsleep 30\n`);
    await chmod(hook, 0o755);
    await writeFile(join(repo, 'README.md'), 'changed\n');

    // commit -a holds index.lock while the hook runs.
    const r = await runGit(repo, ['commit', '-a', '-m', 'feat: x'], { timeoutMs: 1500 });
    expect(r).toMatchObject({ ok: false, error: 'Timed out' });

    const lockExists = await access(join(repo, '.git', 'index.lock')).then(() => true, () => false);
    expect(lockExists).toBe(false);
    const hookPid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(() => process.kill(hookPid, 0)).toThrow(); // the hook process is gone too
    expect((await git(repo, 'rev-list', '--count', 'HEAD')).trim()).toBe('1');
  });

  it('does not reject on an argument containing NUL', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await expect(runGit(repo, ['commit', '-m', 'a\0b'])).resolves.toMatchObject({ ok: false });
  });

  it('does not let GIT_DIR from the environment redirect to another repo', async () => {
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
  it('prefers the fatal/error line over hint lines', () => {
    expect(pickErrorLine('hint: x\nerror: failed to push some refs\n')).toBe('error: failed to push some refs');
  });
  it('picks the rejected push line', () => {
    expect(pickErrorLine(' ! [rejected] main -> main (fetch first)\nerror: failed\n')).toBe(
      '! [rejected] main -> main (fetch first)',
    );
  });
  it('returns the last non-empty line when nothing matches', () => {
    expect(pickErrorLine('foo\nbar\n')).toBe('bar');
  });
  it('returns a generic message for empty output', () => {
    expect(pickErrorLine('')).toBe('git failed');
  });
});
