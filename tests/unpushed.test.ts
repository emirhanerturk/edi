import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readUnpushed, undoLastCommit } from '../src/git/unpushed.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

async function commitFile(repo: string, name: string, text: string, message: string) {
  await writeFile(join(repo, name), text);
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', message);
  return (await git(repo, 'rev-parse', 'HEAD')).trim();
}

/** A repo on main, pushed to its origin, with two more local commits. */
async function repoAhead() {
  const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
  await addBareRemote(repo);
  await git(repo, 'push', '-q', '-u', 'origin', 'main');
  const first = await commitFile(repo, 'a.txt', 'a\n', 'feat: a');
  const second = await commitFile(repo, 'b.txt', 'b\n', 'feat: b');
  return { repo, first, second };
}

describe('readUnpushed', () => {
  it('lists the commits not on the upstream, newest first; the newest can be undone', async () => {
    const { repo, first, second } = await repoAhead();
    const result = await readUnpushed(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commits.map((c) => [c.oid, c.subject])).toEqual([
      [second, 'feat: b'],
      [first, 'feat: a'],
    ]);
    expect(result.canUndo).toBe(true);
  });

  it('nothing without an upstream, and nothing when everything is pushed', async () => {
    const lone = await initRepo(await makeTmpDir(), 'b', { commit: true });
    await commitFile(lone, 'x.txt', 'x\n', 'feat: x');
    expect(await readUnpushed(lone)).toEqual({ ok: true, commits: [], canUndo: false });
    const { repo } = await repoAhead();
    await git(repo, 'push', '-q');
    expect(await readUnpushed(repo)).toEqual({ ok: true, commits: [], canUndo: false });
  });

  it('a merge commit on top cannot be undone', async () => {
    const { repo } = await repoAhead();
    await git(repo, 'switch', '-q', '-c', 'side', 'HEAD~1');
    await commitFile(repo, 'c.txt', 'c\n', 'feat: c');
    await git(repo, 'switch', '-q', 'main');
    await git(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const result = await readUnpushed(repo);
    expect(result.ok && result.commits[0]!.subject).toBe('merge side');
    expect(result.ok && result.canUndo).toBe(false);
  });
});

describe('undoLastCommit', () => {
  it('moves HEAD back one commit and keeps its changes staged', async () => {
    const { repo, first, second } = await repoAhead();
    expect(await undoLastCommit(repo, second)).toEqual({ ok: true, message: 'Commit undone; its changes are staged' });
    expect((await git(repo, 'rev-parse', 'HEAD')).trim()).toBe(first);
    expect(await git(repo, 'status', '--porcelain')).toBe('A  b.txt\n');
  });

  it('refuses when HEAD is no longer the commit the page showed', async () => {
    const { repo, first } = await repoAhead();
    expect(await undoLastCommit(repo, first)).toEqual({ ok: false, error: 'This is no longer the latest commit' });
  });

  it('refuses a pushed commit, a merge, the root commit and a repo without an upstream', async () => {
    const { repo, second } = await repoAhead();
    await git(repo, 'push', '-q');
    expect(await undoLastCommit(repo, second)).toEqual({ ok: false, error: 'This commit was already pushed' });

    const lone = await initRepo(await makeTmpDir(), 'b', { commit: true });
    const root = (await git(lone, 'rev-parse', 'HEAD')).trim();
    expect(await undoLastCommit(lone, root)).toEqual({ ok: false, error: 'The branch has no upstream' });
    await addBareRemote(lone);
    await git(lone, 'push', '-q', '-u', 'origin', 'main');
    await git(lone, 'switch', '-q', '--orphan', 'fresh');
    const orphan = await commitFile(lone, 'o.txt', 'o\n', 'feat: orphan');
    await git(lone, 'branch', '-q', '--set-upstream-to=origin/main');
    expect(await undoLastCommit(lone, orphan)).toEqual({ ok: false, error: 'The first commit cannot be undone' });

    const merged = await repoAhead();
    await git(merged.repo, 'switch', '-q', '-c', 'side', 'HEAD~1');
    await commitFile(merged.repo, 'c.txt', 'c\n', 'feat: c');
    await git(merged.repo, 'switch', '-q', 'main');
    await git(merged.repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const merge = (await git(merged.repo, 'rev-parse', 'HEAD')).trim();
    expect(await undoLastCommit(merged.repo, merge)).toEqual({ ok: false, error: 'A merge commit cannot be undone here' });
  });

  it('refuses a malformed oid', async () => {
    const { repo } = await repoAhead();
    expect(await undoLastCommit(repo, 'HEAD')).toEqual({ ok: false, error: 'Invalid commit' });
  });
});
