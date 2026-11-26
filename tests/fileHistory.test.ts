import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFileHistory, readFileChange, readFileHistory } from '../src/git/fileHistory.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

/** A file made in src/, changed, moved to src/screens/ under a new name, changed again. */
async function history() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a');
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'Ranking.tsx'), 'a\nb\n');
  await writeFile(join(repo, 'other.ts'), 'x\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'feat: first');
  await writeFile(join(repo, 'src', 'Ranking.tsx'), 'a\nb\nc\n');
  await git(repo, 'commit', '-q', '-am', 'feat: second');
  await writeFile(join(repo, 'other.ts'), 'y\n');
  await git(repo, 'commit', '-q', '-am', 'chore: not this file');
  await mkdir(join(repo, 'src', 'screens'));
  await git(repo, 'mv', 'src/Ranking.tsx', 'src/screens/RankingScreen.tsx');
  await git(repo, 'commit', '-q', '-m', 'refactor: move');
  await writeFile(join(repo, 'src', 'screens', 'RankingScreen.tsx'), 'a\nB\nc\n');
  await git(repo, 'commit', '-q', '-am', 'fix: fourth');
  return repo;
}

describe('readFileHistory', () => {
  it('lists the commits that changed the file, newest first, following it through a rename', async () => {
    const repo = await history();
    const result = await readFileHistory(repo, 'src/screens/RankingScreen.tsx', 50);
    if (!result.ok) throw new Error(result.error);
    expect(result.hasMore).toBe(false);
    expect(result.entries.map((entry) => [entry.commit.subject, entry.path, entry.origPath, entry.added, entry.removed])).toEqual([
      ['fix: fourth', 'src/screens/RankingScreen.tsx', null, 1, 1],
      ['refactor: move', 'src/screens/RankingScreen.tsx', 'src/Ranking.tsx', 0, 0],
      ['feat: second', 'src/Ranking.tsx', null, 1, 0],
      ['feat: first', 'src/Ranking.tsx', null, 2, 0],
    ]);
  });

  it('stops at the count and says there are more; an empty repo has none', async () => {
    const repo = await history();
    const result = await readFileHistory(repo, 'src/screens/RankingScreen.tsx', 2);
    expect(result.ok && [result.entries.length, result.hasMore]).toEqual([2, true]);
    const empty = await initRepo(await makeTmpDir(), 'e');
    expect(await readFileHistory(empty, 'x.ts', 50)).toEqual({ ok: true, entries: [], hasMore: false });
  });
});

describe('readFileChange', () => {
  it("gives the file's change in a commit, across a rename, and the whole file in the first commit", async () => {
    const repo = await history();
    const result = await readFileHistory(repo, 'src/screens/RankingScreen.tsx', 50);
    if (!result.ok) throw new Error(result.error);
    const [fourth, move, , first] = result.entries;
    const change = await readFileChange(repo, fourth!.commit.oid, fourth!.path, fourth!.origPath);
    expect(change.ok && change.diff.hunks[0]!.lines.map((line) => `${line.kind} ${line.text}`)).toEqual(['context a', 'del b', 'add B', 'context c']);
    const moved = await readFileChange(repo, move!.commit.oid, move!.path, move!.origPath);
    expect(moved.ok && [moved.diff.hunks.length, moved.diff.added, moved.diff.removed]).toEqual([0, 0, 0]);
    const added = await readFileChange(repo, first!.commit.oid, first!.path, null);
    expect(added.ok && added.diff.hunks[0]!.lines.map((line) => line.kind)).toEqual(['add', 'add']);
  });
});

describe('parseFileHistory', () => {
  it('reads a binary change and skips a commit without a stat', () => {
    const header = (oid: string, subject: string) => [oid, oid.slice(0, 7), '', 'A', 'a@x', '1700000000', '', subject].join('\x1f');
    const out = `${header('a'.repeat(40), 'one')}\0\n-\t-\tlogo.png\0${header('b'.repeat(40), 'two')}\0${header('c'.repeat(40), 'three')}\0\n3\t1\tlogo.png\0`;
    expect(parseFileHistory(out).map((entry) => [entry.commit.subject, entry.binary, entry.added])).toEqual([
      ['one', true, 0],
      ['three', false, 3],
    ]);
  });
});
