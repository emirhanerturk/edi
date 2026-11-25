import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commonDir, refsStamp } from '../src/git/refsStamp.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

/** Sets the times of the ref folders back, so a change made now is seen as newer. */
async function age(repo: string, paths: string[]) {
  const past = new Date(Date.now() - 60_000);
  for (const path of paths) await utimes(join(repo, '.git', path), past, past).catch(() => undefined);
}

describe('refsStamp', () => {
  it('moves on a new tag, a tag in a folder, and a remote branch pushed without -u', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await addBareRemote(repo);
    const common = (await commonDir(repo))!;
    expect(common).toBe(join(repo, '.git'));
    await git(repo, 'tag', 'v1');
    const first = await refsStamp(common);
    expect(first).toBeGreaterThan(0);

    await age(repo, ['refs/tags']);
    const before = await refsStamp(common);
    await git(repo, 'tag', 'release/v2');
    expect(await refsStamp(common)).toBeGreaterThan(before);

    await age(repo, ['refs/tags', 'refs/tags/release']);
    const beforePush = await refsStamp(common);
    await git(repo, 'push', '-q', 'origin', 'main');
    expect(await refsStamp(common)).toBeGreaterThan(beforePush);
  });

  it('stays the same while no ref changes, a commit included', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const common = (await commonDir(repo))!;
    const stamp = await refsStamp(common);
    await git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: x');
    expect(await refsStamp(common)).toBe(stamp);
  });

  it('is 0 when the folder holds no refs', async () => {
    expect(await refsStamp(await makeTmpDir())).toBe(0);
  });
});
