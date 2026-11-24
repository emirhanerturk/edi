import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryOps } from '../src/main/historyOps.js';
import { Workspace } from '../src/main/workspace.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

async function setup() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a', { commit: true });
  const ws = new Workspace({ onChange: () => undefined, statusMs: 60_000 });
  open.push(ws);
  await ws.open(dir);
  return { dir, repo, ops: new HistoryOps(ws) };
}

const UNKNOWN = { ok: false, error: 'Unknown repository' };
const INVALID_COMMIT = { ok: false, error: 'Invalid commit' };

describe('HistoryOps', () => {
  it('keşfedilmemiş repo yolu reddedilir', async () => {
    const { dir, repo, ops } = await setup();
    const oid = (await git(repo, 'rev-parse', 'HEAD')).trim();
    for (const path of [dir, `${repo}/`, join(repo, '.git'), '', null, 7]) {
      expect(await ops.log(path, 50), String(path)).toEqual(UNKNOWN);
      expect(await ops.commit(path, oid), String(path)).toEqual(UNKNOWN);
    }
  });

  it('adet 50 ile 5000 arasında 50 nin katı bir tam sayı olmalı', async () => {
    const { repo, ops } = await setup();
    for (const count of [0, 49, 51, 5050, 1.5, '50', Number.NaN, -50, null]) {
      expect(await ops.log(repo, count), String(count)).toEqual({ ok: false, error: 'Invalid count' });
    }
    expect(await ops.log(repo, 50)).toMatchObject({ ok: true, commits: [{ subject: 'chore: init' }] });
    expect((await ops.log(repo, 100)).ok).toBe(true);
    expect((await ops.log(repo, 5000)).ok).toBe(true);
  });

  it('hex olmayan, kısa, seçenek gibi ya da commit olmayan kimlikler reddedilir', async () => {
    const { repo, ops } = await setup();
    const tree = (await git(repo, 'rev-parse', 'HEAD^{tree}')).trim();
    const blob = (await git(repo, 'rev-parse', 'HEAD:README.md')).trim();
    for (const oid of ['', 'abc', '--output=/tmp/x', 'HEAD', 'g'.repeat(40), 'A'.repeat(40), `${'a'.repeat(40)} `, 7, null]) {
      expect(await ops.commit(repo, oid), String(oid)).toEqual(INVALID_COMMIT);
    }
    expect(await ops.commit(repo, tree)).toEqual({ ok: false, error: 'Commit not found' });
    expect(await ops.commit(repo, blob)).toEqual({ ok: false, error: 'Commit not found' });
    expect(await ops.commit(repo, 'deadbeef'.repeat(5))).toEqual({ ok: false, error: 'Commit not found' });
  });

  it("kısa kimlik tam commit'e çözülür", async () => {
    const { repo, ops } = await setup();
    await writeFile(join(repo, 'b.txt'), 'b\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: b');
    const oid = (await git(repo, 'rev-parse', 'HEAD')).trim();
    expect(await ops.commit(repo, oid.slice(0, 7))).toMatchObject({ ok: true, commit: { oid, subject: 'feat: b', files: [{ path: 'b.txt' }] } });
  });
});
