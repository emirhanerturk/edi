import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ALREADY_REVERTED, REVERT_CONFLICT, revertCommit } from '../src/git/revert.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

async function commitFile(repo: string, name: string, text: string, message: string) {
  await writeFile(join(repo, name), text);
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', message);
  return (await git(repo, 'rev-parse', 'HEAD')).trim();
}

const subject = async (repo: string) => (await git(repo, 'log', '-1', '--format=%s')).trim();
const head = async (repo: string) => (await git(repo, 'rev-parse', 'HEAD')).trim();
const has = (repo: string, name: string) => stat(join(repo, '.git', name)).then(() => true, () => false);

/** f: a → b (`two`, the usual target) → c; then g: x in `three`. */
async function threeCommits() {
  const repo = await initRepo(await makeTmpDir(), 'r', { commit: true });
  const one = await commitFile(repo, 'f', 'a\n', 'one');
  const two = await commitFile(repo, 'f', 'b\n', 'two');
  const three = await commitFile(repo, 'g', 'x\n', 'three');
  return { repo, one, two, three };
}

describe('revertCommit', () => {
  it('reverts a commit with one new commit; the original stays', async () => {
    const { repo, two } = await threeCommits();
    expect(await revertCommit(repo, two)).toEqual({ ok: true, message: 'Commit reverted' });
    expect(await subject(repo)).toBe('Revert "two"');
    expect(await readFile(join(repo, 'f'), 'utf8')).toBe('a\n');
    expect(await git(repo, 'log', '--format=%s')).toContain('two\n');
    expect(await has(repo, 'REVERT_HEAD')).toBe(false);
  });

  it('a conflicting revert is aborted and nothing is left half done', async () => {
    const { repo, two } = await threeCommits();
    await commitFile(repo, 'f', 'c\n', 'four');
    const before = await head(repo);
    await writeFile(join(repo, 'g'), 'uncommitted\n');
    expect(await revertCommit(repo, two)).toEqual({ ok: false, error: REVERT_CONFLICT });
    expect(await head(repo)).toBe(before);
    expect(await readFile(join(repo, 'f'), 'utf8')).toBe('c\n');
    expect(await readFile(join(repo, 'g'), 'utf8')).toBe('uncommitted\n');
    expect(await has(repo, 'REVERT_HEAD')).toBe(false);
    expect(await git(repo, 'status', '--porcelain')).toBe(' M g\n');
  });

  it('reverting an already undone commit says so and leaves no state', async () => {
    const { repo, three } = await threeCommits();
    expect((await revertCommit(repo, three)).ok).toBe(true);
    const before = await head(repo);
    expect(await revertCommit(repo, three)).toEqual({ ok: false, error: ALREADY_REVERTED });
    expect(await head(repo)).toBe(before);
    expect(await has(repo, 'REVERT_HEAD')).toBe(false);
    expect(await git(repo, 'status', '--porcelain')).toBe('');
  });

  it('refuses while another operation is in progress, without touching it', async () => {
    const { repo, one } = await threeCommits();
    await git(repo, 'switch', '-q', '-c', 'side', one);
    const picked = await commitFile(repo, 'f', 'side\n', 'side');
    await git(repo, 'switch', '-q', 'main');
    await promisify(execFile)('git', ['cherry-pick', picked], { cwd: repo }).catch(() => undefined);
    expect(await has(repo, 'CHERRY_PICK_HEAD')).toBe(true);
    expect(await revertCommit(repo, one)).toEqual({ ok: false, error: 'A cherry-pick is in progress; finish it first' });
    expect(await has(repo, 'CHERRY_PICK_HEAD')).toBe(true);
  });

  it('refuses a commit that is not on the current branch', async () => {
    const { repo } = await threeCommits();
    await git(repo, 'switch', '-q', '-c', 'side');
    const other = await commitFile(repo, 'h', 'h\n', 'side only');
    await git(repo, 'switch', '-q', 'main');
    const before = await head(repo);
    expect(await revertCommit(repo, other)).toEqual({ ok: false, error: 'This commit is not on the current branch' });
    expect(await head(repo)).toBe(before);
  });

  it('refuses a merge commit', async () => {
    const { repo } = await threeCommits();
    await git(repo, 'switch', '-q', '-c', 'side');
    await commitFile(repo, 'h', 'h\n', 'side only');
    await git(repo, 'switch', '-q', 'main');
    await git(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    expect(await revertCommit(repo, await head(repo))).toEqual({ ok: false, error: 'A merge commit cannot be reverted here' });
  });

  it('local changes in the way are refused by git, and kept', async () => {
    const { repo, one } = await threeCommits();
    const before = await head(repo);
    await writeFile(join(repo, 'h'), 'staged\n');
    await git(repo, 'add', 'h');
    const result = await revertCommit(repo, one);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/local changes/i);
    expect(await head(repo)).toBe(before);
    expect(await git(repo, 'status', '--porcelain')).toBe('A  h\n');
    expect(await has(repo, 'REVERT_HEAD')).toBe(false);
  });

  it('rejects a malformed or unknown oid', async () => {
    const { repo } = await threeCommits();
    for (const oid of ['abc', 42, '-x'.padEnd(40, '0'), 'HEAD']) {
      expect(await revertCommit(repo, oid), String(oid)).toEqual({ ok: false, error: 'Invalid commit' });
    }
    expect(await revertCommit(repo, 'f'.repeat(40))).toEqual({ ok: false, error: 'Commit not found' });
  });
});
