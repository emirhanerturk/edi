import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SearchOps } from '../src/main/searchOps.js';
import { Workspace } from '../src/main/workspace.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

async function setup() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', { commit: true });
  await writeFile(join(repo, 'rank.ts'), 'weeklyRank\n');
  const ws = new Workspace({ onChange: () => undefined, statusMs: 60_000 });
  open.push(ws);
  await ws.open(dir);
  return { dir, repo, ops: new SearchOps(ws) };
}

const query = { pattern: 'weeklyRank', regex: false, matchCase: false, wholeWord: false, include: '' };
const INVALID = { ok: false, error: 'Invalid search' };

describe('SearchOps', () => {
  it('searches only a discovered repository, with a well-formed search', async () => {
    const { dir, repo, ops } = await setup();
    expect(await ops.search(dir, query, 1)).toEqual({ ok: false, error: 'Unknown repository' });
    expect(await ops.search(repo, { ...query, pattern: '' }, 2)).toEqual(INVALID);
    expect(await ops.search(repo, query, 'three')).toEqual(INVALID);
    const found = await ops.search(repo, query, 4);
    expect(found.ok && found.files.map((file) => file.path)).toEqual(['rank.ts']);
  });

  it('refuses an older search than the newest one', async () => {
    const { repo, ops } = await setup();
    ops.stop(10);
    expect(await ops.search(repo, query, 9)).toEqual({ ok: false, error: 'Stopped' });
    expect((await ops.search(repo, query, 11)).ok).toBe(true);
  });

  it('replaces only with a stamp, lines and a path inside the repository', async () => {
    const { repo, ops } = await setup();
    const found = await ops.search(repo, query, 1);
    if (!found.ok) throw new Error(found.error);
    const stamp = found.files[0]!.stamp;
    expect(await ops.replace(repo, '../rank.ts', query, 'x', stamp, [1])).toEqual(INVALID);
    expect(await ops.replace(repo, 'rank.ts', query, 'x', 'not a stamp', [1])).toEqual(INVALID);
    expect(await ops.replace(repo, 'rank.ts', query, 'x', stamp, [])).toEqual(INVALID);
    expect(await ops.replace(repo, 'rank.ts', query, 'x', stamp, [0])).toEqual(INVALID);
    expect(await ops.replace(repo, 'rank.ts', query, 42, stamp, [1])).toEqual(INVALID);
    expect(await ops.replace(repo, 'rank.ts', query, 'weekRank', stamp, [1])).toEqual(expect.objectContaining({ ok: true, count: 1 }));
    expect(await readFile(join(repo, 'rank.ts'), 'utf8')).toBe('weekRank\n');
  });
});
