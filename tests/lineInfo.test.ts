import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blameText, parseBlame, readHeadText } from '../src/git/lineInfo.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

async function repoWithHistory() {
  const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
  await writeFile(join(repo, 'app.ts'), 'one\ntwo\n');
  await git(repo, 'add', '-A');
  await git(repo, '-c', 'user.name=Ada', '-c', 'user.email=ada@x.dev', 'commit', '-q', '-m', 'feat: first two');
  await writeFile(join(repo, 'app.ts'), 'one\ntwo\nthree\n');
  await git(repo, 'add', '-A');
  await git(repo, '-c', 'user.name=Linus', '-c', 'user.email=linus@x.dev', 'commit', '-q', '-m', 'feat: third');
  return repo;
}

describe('readHeadText', () => {
  it("returns the file's text at HEAD, ignoring the working tree", async () => {
    const repo = await repoWithHistory();
    await writeFile(join(repo, 'app.ts'), 'changed\n');
    expect(await readHeadText(repo, 'app.ts')).toEqual({ ok: true, text: 'one\ntwo\nthree\n' });
  });

  it('null for a file that is not in HEAD and in a repo without commits', async () => {
    const repo = await repoWithHistory();
    await writeFile(join(repo, 'new.ts'), 'x\n');
    expect(await readHeadText(repo, 'new.ts')).toEqual({ ok: true, text: null });
    const empty = await initRepo(await makeTmpDir(), 'b');
    await writeFile(join(empty, 'a.ts'), 'x\n');
    expect(await readHeadText(empty, 'a.ts')).toEqual({ ok: true, text: null });
  });

  it('refuses paths that leave the repo or reach into .git', async () => {
    const repo = await repoWithHistory();
    for (const path of ['../x', '/etc/hosts', '.git/config', '', 'a\0b']) {
      expect(await readHeadText(repo, path), path).toEqual({ ok: false, error: 'File is outside the repository' });
    }
  });
});

describe('blameText', () => {
  it('names the commit of each line of the given text; edited lines are not committed yet', async () => {
    const repo = await repoWithHistory();
    const result = await blameText(repo, 'app.ts', 'one\nTWO\nthree\nfour\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const who = result.lines.map((oid) => (oid === null ? null : result.commits[oid]!.authorName));
    expect(who).toEqual(['Ada', null, 'Linus', null]);
    const third = result.commits[result.lines[2]!]!;
    expect(third).toMatchObject({ authorName: 'Linus', authorEmail: 'linus@x.dev', summary: 'feat: third' });
    expect(third.date).toBeGreaterThan(1_600_000_000_000);
    expect(result.lines[2]).toMatch(/^[0-9a-f]{40}$/);
  });

  it('a file not in HEAD has no committed lines; a path outside the repo is refused', async () => {
    const repo = await repoWithHistory();
    expect(await blameText(repo, 'new.ts', 'x\n')).toEqual({ ok: true, lines: [null], commits: {} });
    expect(await blameText(repo, '../x', 'x\n')).toEqual({ ok: false, error: 'File is outside the repository' });
  });
});

describe('parseBlame', () => {
  it('reads porcelain output where later lines of a commit repeat only the oid', () => {
    const a = 'a'.repeat(40);
    const zero = '0'.repeat(40);
    const out = [
      `${a} 1 1 2`,
      'author Ada Lovelace',
      'author-mail <ada@x.dev>',
      'author-time 1700000000',
      'author-tz +0000',
      'summary feat: start',
      'filename app.ts',
      '\tone',
      `${a} 2 2`,
      '\ttwo',
      `${zero} 3 3 1`,
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 1800000000',
      'summary Version of app.ts from app.ts',
      'filename app.ts',
      '\tthree',
      '',
    ].join('\n');
    expect(parseBlame(out)).toEqual({
      lines: [a, a, null],
      commits: { [a]: { authorName: 'Ada Lovelace', authorEmail: 'ada@x.dev', date: 1_700_000_000_000, summary: 'feat: start' } },
    });
  });
});
