import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverRepos } from '../src/git/discover.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

describe('discoverRepos', () => {
  it('alt seviyedeki repoları ada göre listeler', async () => {
    const parent = await makeTmpDir();
    // Sıra dışı oluştur ki sıralama gerçekten sınansın.
    await mkdir(join(parent, 'c'));
    await writeFile(join(parent, 'c', '.git'), 'gitdir: /baska/yer\n'); // worktree/submodule: .git bir dosya
    await mkdir(join(parent, 'b'));
    await initRepo(parent, 'a');
    await writeFile(join(parent, 'dosya.txt'), 'x');

    expect(await discoverRepos(parent)).toEqual([
      { name: 'a', path: join(parent, 'a') },
      { name: 'c', path: join(parent, 'c') },
    ]);
  });

  it('klasörün kendisi repoysa yalnız onu döner', async () => {
    const parent = await makeTmpDir();
    const repoA = await initRepo(parent, 'a');
    await initRepo(repoA, 'ic-repo');
    expect(await discoverRepos(repoA)).toEqual([{ name: 'a', path: repoA }]);
  });

  it('repo yoksa boş döner', async () => {
    expect(await discoverRepos(await makeTmpDir())).toEqual([]);
  });

  it('olmayan klasörde boş döner', async () => {
    expect(await discoverRepos('/yok/boyle/yer')).toEqual([]);
  });
});
