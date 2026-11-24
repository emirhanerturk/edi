import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseLog, readLog } from '../src/git/log.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);
const US = '\x1f';

/** Verilen zamanda (epoch saniye) commit atar; commit'in tam kimliğini döner. */
async function commitAt(repo: string, subject: string, seconds: number, file = 'a.txt'): Promise<string> {
  await writeFile(join(repo, file), `${subject}\n`);
  await git(repo, 'add', '-A');
  const date = `@${seconds} +0000`;
  await run('git', ['commit', '-q', '-m', subject], { cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return (await git(repo, 'rev-parse', 'HEAD')).trim();
}

describe('parseLog', () => {
  it('alanları ve etiketleri okur', () => {
    const record = (fields: string[]) => `${fields.join(US)}\0`;
    const out =
      record(['a'.repeat(40), 'aaaaaaa', `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'Ada', 'ada@x.dev', '1700000000', 'HEAD -> main, tag: v1.2.0, origin/main, tag: latest', 'Merge: ğüş — "x"']) +
      record(['b'.repeat(40), 'bbbbbbb', '', 'Bob', 'bob@x.dev', '1690000000', '', '']);
    expect(parseLog(out)).toEqual([
      {
        oid: 'a'.repeat(40),
        short: 'aaaaaaa',
        subject: 'Merge: ğüş — "x"',
        authorName: 'Ada',
        authorEmail: 'ada@x.dev',
        date: 1_700_000_000_000,
        parents: 2,
        tags: ['v1.2.0', 'latest'],
      },
      { oid: 'b'.repeat(40), short: 'bbbbbbb', subject: '', authorName: 'Bob', authorEmail: 'bob@x.dev', date: 1_690_000_000_000, parents: 0, tags: [] },
    ]);
  });

  it('boş çıktıda boş liste', () => {
    expect(parseLog('')).toEqual([]);
  });
});

describe('readLog', () => {
  it('yeniden eskiye sıralar; fazlası varsa bunu söyler', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: bir', 1_700_000_000);
    await commitAt(repo, 'feat: iki', 1_700_000_100);
    await commitAt(repo, 'fix: üç', 1_700_000_200);

    const two = await readLog(repo, 2);
    expect(two.ok && two.commits.map((c) => c.subject)).toEqual(['fix: üç', 'feat: iki']);
    expect(two.ok && two.hasMore).toBe(true);
    expect(two.ok && two.commits[0]!.date).toBe(1_700_000_200_000);

    const all = await readLog(repo, 3);
    expect(all.ok && all.commits).toHaveLength(3);
    expect(all.ok && all.hasMore).toBe(false);
    expect(all).toMatchObject({ ok: true, userEmail: 'test@example.com', upstream: null, unpushed: [] });
  });

  it('etiketleri ve merge commit\'ini tanır', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: ilk', 1_700_000_000);
    await git(repo, 'tag', 'v1.0.0');
    await git(repo, 'switch', '-q', '-c', 'yan');
    await commitAt(repo, 'feat: yan', 1_700_000_100, 'b.txt');
    await git(repo, 'switch', '-q', 'main');
    await commitAt(repo, 'feat: ana', 1_700_000_200, 'c.txt');
    await run('git', ['merge', '-q', '--no-ff', '-m', 'Merge branch yan', 'yan'], {
      cwd: repo,
      env: { ...process.env, GIT_COMMITTER_DATE: '@1700000300 +0000', GIT_AUTHOR_DATE: '@1700000300 +0000' },
    });
    await git(repo, 'tag', '-a', 'v1.1.0', '-m', 'sürüm');

    const log = await readLog(repo, 50);
    if (!log.ok) throw new Error(log.error);
    expect(log.commits.map((c) => [c.subject, c.parents, c.tags])).toEqual([
      ['Merge branch yan', 2, ['v1.1.0']],
      ['feat: ana', 1, []],
      ['feat: yan', 1, []],
      ['feat: ilk', 0, ['v1.0.0']],
    ]);
  });

  it("commit'i olmayan repoda boş liste", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    expect(await readLog(repo, 50)).toEqual({ ok: true, commits: [], hasMore: false, unpushed: [], upstream: null, userEmail: 'test@example.com' });
  });

  it("detached HEAD'de o commit'ten geriye okur", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: bir', 1_700_000_000);
    await commitAt(repo, 'feat: iki', 1_700_000_100);
    await git(repo, 'checkout', '-q', '--detach', 'HEAD~1');
    const log = await readLog(repo, 50);
    expect(log.ok && log.commits.map((c) => c.subject)).toEqual(['feat: bir']);
  });

  it("upstream'de olmayan commit'ler push edilmemiş sayılır", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await addBareRemote(repo);
    await commitAt(repo, 'feat: gitti', 1_700_000_000);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    const local = await commitAt(repo, 'feat: yerelde', 1_700_000_100);

    expect(await readLog(repo, 50)).toMatchObject({ ok: true, upstream: 'origin/main', unpushed: [local] });
  });

  it("upstream'i olmayan branch'te uzaktaki hiçbir branch'te olmayanlar push edilmemiştir", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await addBareRemote(repo);
    await commitAt(repo, 'feat: gitti', 1_700_000_000);
    await git(repo, 'push', '-q', 'origin', 'main');
    await git(repo, 'switch', '-q', '-c', 'feat/yeni');
    const local = await commitAt(repo, 'feat: yerelde', 1_700_000_100);

    expect(await readLog(repo, 50)).toMatchObject({ ok: true, upstream: null, unpushed: [local] });
  });

  it('remote yoksa ok işareti de yok', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: bir', 1_700_000_000);
    expect(await readLog(repo, 50)).toMatchObject({ ok: true, upstream: null, unpushed: [] });
  });

  it('upstream silinmişse çökmez', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await addBareRemote(repo);
    const pushed = await commitAt(repo, 'feat: gitti', 1_700_000_000);
    await git(repo, 'push', '-q', 'origin', 'main');
    await git(repo, 'config', 'branch.main.remote', 'origin');
    await git(repo, 'config', 'branch.main.merge', 'refs/heads/silindi');
    const local = await commitAt(repo, 'feat: yerelde', 1_700_000_100);

    const log = await readLog(repo, 50);
    expect(log).toMatchObject({ ok: true, upstream: null, unpushed: [local] });
    expect(log.ok && log.unpushed).not.toContain(pushed);
  });

  it('kullanıcının log ayarları çıktıyı bozmaz', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: bir', 1_700_000_000);
    await git(repo, 'tag', 'v1');
    for (const [key, value] of [
      ['log.showSignature', 'true'],
      ['format.pretty', 'oneline'],
      ['log.decorate', 'full'],
      ['color.ui', 'always'],
      ['log.abbrevCommit', 'true'],
      ['core.abbrev', '12'],
    ] as const) {
      await git(repo, 'config', key, value);
    }
    const log = await readLog(repo, 50);
    expect(log.ok && log.commits.map((c) => [c.subject, c.tags, c.oid.length])).toEqual([['feat: bir', ['v1'], 40]]);
  });

  it('sığ klondaki commit\'leri listeler', async () => {
    const parent = await makeTmpDir();
    const repo = await initRepo(parent, 'a');
    await commitAt(repo, 'feat: bir', 1_700_000_000);
    await commitAt(repo, 'feat: iki', 1_700_000_100);
    await commitAt(repo, 'feat: üç', 1_700_000_200);
    const clone = join(parent, 'sig');
    await git(parent, 'clone', '-q', '--depth', '2', `file://${repo}`, clone);

    const log = await readLog(clone, 50);
    expect(log.ok && log.commits.map((c) => c.subject)).toEqual(['feat: üç', 'feat: iki']);
    expect(log.ok && log.hasMore).toBe(false);
    expect(log).toMatchObject({ upstream: 'origin/main', unpushed: [] });
  });

  it('repo olmayan klasörde hata', async () => {
    expect((await readLog(await makeTmpDir(), 50)).ok).toBe(false);
  });
});
