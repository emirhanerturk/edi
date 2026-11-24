import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseLog, readLog } from '../src/git/log.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);
const US = '\x1f';

/** Commits at the given time (epoch seconds) and returns the full commit id. */
async function commitAt(repo: string, subject: string, seconds: number, file = 'a.txt'): Promise<string> {
  await writeFile(join(repo, file), `${subject}\n`);
  await git(repo, 'add', '-A');
  const date = `@${seconds} +0000`;
  await run('git', ['commit', '-q', '-m', subject], { cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return (await git(repo, 'rev-parse', 'HEAD')).trim();
}

describe('parseLog', () => {
  it('reads the fields and tags', () => {
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

  it('returns an empty list for empty output', () => {
    expect(parseLog('')).toEqual([]);
  });
});

describe('readLog', () => {
  it('sorts newest first and says when there are more', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: one', 1_700_000_000);
    await commitAt(repo, 'feat: two', 1_700_000_100);
    await commitAt(repo, 'fix: three', 1_700_000_200);

    const two = await readLog(repo, 2);
    expect(two.ok && two.commits.map((c) => c.subject)).toEqual(['fix: three', 'feat: two']);
    expect(two.ok && two.hasMore).toBe(true);
    expect(two.ok && two.commits[0]!.date).toBe(1_700_000_200_000);

    const all = await readLog(repo, 3);
    expect(all.ok && all.commits).toHaveLength(3);
    expect(all.ok && all.hasMore).toBe(false);
    expect(all).toMatchObject({ ok: true, userEmail: 'test@example.com', upstream: null, unpushed: [] });
  });

  it('recognizes tags and merge commits', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: first', 1_700_000_000);
    await git(repo, 'tag', 'v1.0.0');
    await git(repo, 'switch', '-q', '-c', 'side');
    await commitAt(repo, 'feat: side', 1_700_000_100, 'b.txt');
    await git(repo, 'switch', '-q', 'main');
    await commitAt(repo, 'feat: main', 1_700_000_200, 'c.txt');
    await run('git', ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], {
      cwd: repo,
      env: { ...process.env, GIT_COMMITTER_DATE: '@1700000300 +0000', GIT_AUTHOR_DATE: '@1700000300 +0000' },
    });
    await git(repo, 'tag', '-a', 'v1.1.0', '-m', 'release');

    const log = await readLog(repo, 50);
    if (!log.ok) throw new Error(log.error);
    expect(log.commits.map((c) => [c.subject, c.parents, c.tags])).toEqual([
      ['Merge branch side', 2, ['v1.1.0']],
      ['feat: main', 1, []],
      ['feat: side', 1, []],
      ['feat: first', 0, ['v1.0.0']],
    ]);
  });

  it('returns an empty list in a repo without commits', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    expect(await readLog(repo, 50)).toEqual({ ok: true, commits: [], hasMore: false, unpushed: [], upstream: null, userEmail: 'test@example.com' });
  });

  it('reads back from the commit on a detached HEAD', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: one', 1_700_000_000);
    await commitAt(repo, 'feat: two', 1_700_000_100);
    await git(repo, 'checkout', '-q', '--detach', 'HEAD~1');
    const log = await readLog(repo, 50);
    expect(log.ok && log.commits.map((c) => c.subject)).toEqual(['feat: one']);
  });

  it('counts commits missing from the upstream as unpushed', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await addBareRemote(repo);
    await commitAt(repo, 'feat: pushed', 1_700_000_000);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    const local = await commitAt(repo, 'feat: local', 1_700_000_100);

    expect(await readLog(repo, 50)).toMatchObject({ ok: true, upstream: 'origin/main', unpushed: [local] });
  });

  it('on a branch without an upstream, counts commits on no remote branch as unpushed', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await addBareRemote(repo);
    await commitAt(repo, 'feat: pushed', 1_700_000_000);
    await git(repo, 'push', '-q', 'origin', 'main');
    await git(repo, 'switch', '-q', '-c', 'feat/new');
    const local = await commitAt(repo, 'feat: local', 1_700_000_100);

    expect(await readLog(repo, 50)).toMatchObject({ ok: true, upstream: null, unpushed: [local] });
  });

  it('shows no arrow marker without a remote', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: one', 1_700_000_000);
    expect(await readLog(repo, 50)).toMatchObject({ ok: true, upstream: null, unpushed: [] });
  });

  it('does not crash when the upstream was deleted', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await addBareRemote(repo);
    const pushed = await commitAt(repo, 'feat: pushed', 1_700_000_000);
    await git(repo, 'push', '-q', 'origin', 'main');
    await git(repo, 'config', 'branch.main.remote', 'origin');
    await git(repo, 'config', 'branch.main.merge', 'refs/heads/deleted');
    const local = await commitAt(repo, 'feat: local', 1_700_000_100);

    const log = await readLog(repo, 50);
    expect(log).toMatchObject({ ok: true, upstream: null, unpushed: [local] });
    expect(log.ok && log.unpushed).not.toContain(pushed);
  });

  it("is not broken by the user's log settings", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await commitAt(repo, 'feat: one', 1_700_000_000);
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
    expect(log.ok && log.commits.map((c) => [c.subject, c.tags, c.oid.length])).toEqual([['feat: one', ['v1'], 40]]);
  });

  it('lists the commits in a shallow clone', async () => {
    const parent = await makeTmpDir();
    const repo = await initRepo(parent, 'a');
    await commitAt(repo, 'feat: one', 1_700_000_000);
    await commitAt(repo, 'feat: two', 1_700_000_100);
    await commitAt(repo, 'feat: three', 1_700_000_200);
    const clone = join(parent, 'shallow');
    await git(parent, 'clone', '-q', '--depth', '2', `file://${repo}`, clone);

    const log = await readLog(clone, 50);
    expect(log.ok && log.commits.map((c) => c.subject)).toEqual(['feat: three', 'feat: two']);
    expect(log.ok && log.hasMore).toBe(false);
    expect(log).toMatchObject({ upstream: 'origin/main', unpushed: [] });
  });

  it('fails in a folder that is not a repo', async () => {
    expect((await readLog(await makeTmpDir(), 50)).ok).toBe(false);
  });
});
