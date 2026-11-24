import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverRepos } from '../src/git/discover.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

describe('discoverRepos', () => {
  it('lists child repos sorted by name', async () => {
    const parent = await makeTmpDir();
    // Create them out of order so the sort is really tested.
    await mkdir(join(parent, 'c'));
    await writeFile(join(parent, 'c', '.git'), 'gitdir: /elsewhere\n'); // worktree/submodule: .git is a file
    await mkdir(join(parent, 'b'));
    await initRepo(parent, 'a');
    await writeFile(join(parent, 'file.txt'), 'x');

    expect(await discoverRepos(parent)).toEqual([
      { name: 'a', path: join(parent, 'a') },
      { name: 'c', path: join(parent, 'c') },
    ]);
  });

  it('returns only the folder itself when it is a repo', async () => {
    const parent = await makeTmpDir();
    const repoA = await initRepo(parent, 'a');
    await initRepo(repoA, 'inner-repo');
    expect(await discoverRepos(repoA)).toEqual([{ name: 'a', path: repoA }]);
  });

  it('returns an empty list when there are no repos', async () => {
    expect(await discoverRepos(await makeTmpDir())).toEqual([]);
  });

  it('returns an empty list for a missing folder', async () => {
    expect(await discoverRepos('/no/such/place')).toEqual([]);
  });
});
