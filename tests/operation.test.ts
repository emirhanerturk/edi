import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { operationIn } from '../src/git/operation.js';
import { gitDirs } from '../src/git/refsStamp.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

/** A repo where `main` and `other` both change `a.txt`. */
async function diverged() {
  const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
  await writeFile(join(repo, 'a.txt'), 'base\n');
  await git(repo, 'add', 'a.txt');
  await git(repo, 'commit', '-q', '-m', 'base');
  await git(repo, 'switch', '-q', '-c', 'other');
  await writeFile(join(repo, 'a.txt'), 'other\n');
  await git(repo, 'commit', '-q', '-am', 'other');
  await git(repo, 'switch', '-q', 'main');
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await git(repo, 'commit', '-q', '-am', 'main');
  const dir = (await gitDirs(repo))!.git;
  return { repo, operation: () => operationIn(dir) };
}

const fails = (promise: Promise<unknown>) => promise.then(() => 'ok', () => 'failed');

describe('operationIn', () => {
  it('none in a clean repo; a merge, then a rebase, waiting on conflicts', async () => {
    const { repo, operation } = await diverged();
    expect(await operation()).toBeNull();
    expect(await fails(git(repo, 'merge', '-q', 'other'))).toBe('failed');
    expect(await operation()).toBe('merge');
    await git(repo, 'merge', '--abort');
    expect(await fails(git(repo, 'rebase', '-q', 'other'))).toBe('failed');
    expect(await operation()).toBe('rebase');
    await git(repo, 'rebase', '--abort');
    expect(await fails(git(repo, 'cherry-pick', 'other'))).toBe('failed');
    expect(await operation()).toBe('cherry-pick');
  });

  it('none after a stash applied with conflicts', async () => {
    const { repo, operation } = await diverged();
    await writeFile(join(repo, 'a.txt'), 'stashed\n');
    await git(repo, 'stash', '-q');
    await writeFile(join(repo, 'a.txt'), 'later\n');
    await git(repo, 'commit', '-q', '-am', 'later');
    expect(await fails(git(repo, 'stash', 'apply', '-q'))).toBe('failed');
    expect(await git(repo, 'diff', '--name-only', '--diff-filter=U')).toContain('a.txt');
    expect(await operation()).toBeNull();
  });
});
