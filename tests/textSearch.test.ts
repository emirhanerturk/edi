import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGED, TOO_SLOW, cutLine, expand, findMatches, guarded, replaceInFile, replaceLines, searchRepo, stampOf, textQuery } from '../src/git/textSearch.js';
import { buildPattern, includeFilter } from '../src/shared/textPattern.js';
import type { TextQuery } from '../src/git/types.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const query = (pattern: string, over: Partial<TextQuery> = {}): TextQuery => ({ pattern, regex: false, matchCase: false, wholeWord: false, include: '', ...over });

async function repoWithFiles() {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'a');
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'rank.ts'), 'const weeklyRank = 1;\nexport { weeklyRank };\r\nconst other = 2;\n');
  await writeFile(join(repo, 'src', 'rank.test.ts'), "it('weeklyRank', () => {});\n");
  await writeFile(join(repo, 'README.md'), 'The WeeklyRank shows here.\n');
  await writeFile(join(repo, 'binary.bin'), Buffer.from([0x77, 0x65, 0x00, 0x6b]));
  await writeFile(join(repo, '.gitignore'), 'dist/\n');
  await mkdir(join(repo, 'dist'));
  await writeFile(join(repo, 'dist', 'out.js'), 'weeklyRank\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'feat: rank');
  await writeFile(join(repo, 'new.ts'), 'weeklyRank(); weeklyRank();\n');
  return repo;
}

describe('buildPattern and includeFilter', () => {
  it('finds the text as typed, as a word, or as a regular expression', () => {
    const literal = buildPattern({ pattern: 'a.b', regex: false, matchCase: false, wholeWord: false });
    expect(literal.ok && 'xa.b axb'.match(literal.re)).toEqual(['a.b']);
    const word = buildPattern({ pattern: 'rank', regex: false, matchCase: true, wholeWord: true });
    expect(word.ok && 'rank ranking Rank'.match(word.re)).toEqual(['rank']);
    expect(buildPattern({ pattern: 'fetch(', regex: true, matchCase: false, wholeWord: false })).toEqual({ ok: false, error: 'Not a valid regular expression: unterminated group' });
  });

  it('includes paths by glob or by part, and leaves out the ones after !', () => {
    const wanted = includeFilter('src/**, !*.test.ts');
    expect(['src/rank.ts', 'src/a/b.ts', 'src/rank.test.ts', 'lib/x.ts'].filter(wanted)).toEqual(['src/rank.ts', 'src/a/b.ts']);
    expect(['a.md', 'b.ts'].filter(includeFilter('.md'))).toEqual(['a.md']);
    expect(['a.md', 'b.ts'].filter(includeFilter(' , '))).toEqual(['a.md', 'b.ts']);
  });
});

describe('textQuery', () => {
  it('takes only a well-formed query', () => {
    expect(textQuery(query('x'))).toEqual(query('x'));
    expect(textQuery({ ...query('x'), regex: 'yes' })).toBeNull();
    expect(textQuery(query(''))).toBeNull();
    expect(textQuery(null)).toBeNull();
  });
});

describe('findMatches and cutLine', () => {
  it('lists the lines with matches and skips empty matches', () => {
    const pattern = buildPattern({ pattern: 'a*', regex: true, matchCase: false, wholeWord: false });
    if (!pattern.ok) throw new Error(pattern.error);
    expect(findMatches(pattern.re, 'baab\nbb\r\naa', 10)).toEqual([
      { line: 1, text: 'baab', ranges: [[1, 3]], count: 1 },
      { line: 3, text: 'aa', ranges: [[0, 2]], count: 1 },
    ]);
  });

  it('cuts a long line around its first match', () => {
    const text = `${'x'.repeat(500)}match${'y'.repeat(500)}`;
    const line = cutLine(7, text, [[500, 505]], 1);
    expect(line.from).toBe(460);
    expect(line.text.slice(line.ranges[0]![0], line.ranges[0]![1])).toBe('match');
    expect(line.cut).toBe(true);
  });
});

describe('expand', () => {
  it('builds the replacement as String.replace does', () => {
    const cases: [RegExp, string, string][] = [
      [/(w)(e+)/g, '[$2$1] $$ $& $0 $3 $10', 'a weekly week'],
      [/(?<first>\w)\w*/g, '<$<first>> $<missing>', 'ab cd'],
      [/b/g, "($`|$')", 'abc'],
    ];
    for (const [re, template, subject] of cases) {
      const ours = subject.replace(re, (...args: unknown[]) => expand(template, args));
      expect(ours).toBe(subject.replace(re, template));
    }
  });

  it('replaces the given lines, keeping their line endings', () => {
    const pattern = buildPattern({ pattern: '(\\w+)Rank', regex: true, matchCase: true, wholeWord: false });
    if (!pattern.ok) throw new Error(pattern.error);
    expect(replaceLines(pattern.re, 'weeklyRank\r\nweeklyRank\nmonthlyRank', [1, 3], '$1Place', true)).toEqual({
      text: 'weeklyPlace\r\nweeklyRank\nmonthlyPlace',
      count: 2,
    });
    expect(replaceLines(pattern.re, 'weeklyRank', [1], '$1', false).text).toBe('$1');
  });
});

describe('guarded', () => {
  it('stops a pattern that runs too long', () => {
    expect(() => guarded(() => /(a+)+b/.test('a'.repeat(40)), 100)).toThrow(TOO_SLOW);
    expect(guarded(() => 1 + 1)).toBe(2);
  });
});

describe('searchRepo', () => {
  it('searches tracked and new files, not ignored or binary ones, in path order', async () => {
    const repo = await repoWithFiles();
    const result = await searchRepo(repo, query('weeklyrank'));
    if (!result.ok) throw new Error(result.error);
    expect(result.files.map((file) => [file.path, file.lines.map((line) => [line.line, line.ranges])])).toEqual([
      ['README.md', [[1, [[4, 14]]]]],
      ['new.ts', [[1, [[0, 10], [14, 24]]]]],
      ['src/rank.test.ts', [[1, [[4, 14]]]]],
      ['src/rank.ts', [[1, [[6, 16]]], [2, [[9, 19]]]]],
    ]);
    expect(result.count).toBe(6);
    expect(result.truncated).toBe(false);
    expect(result.files[3]!.lines[1]!.text).toBe('export { weeklyRank };');
  });

  it('honors match case, the files to include, and the limit', async () => {
    const repo = await repoWithFiles();
    const cased = await searchRepo(repo, query('WeeklyRank', { matchCase: true }));
    expect(cased.ok && cased.files.map((file) => file.path)).toEqual(['README.md']);
    const included = await searchRepo(repo, query('weeklyRank', { include: 'src/**, !*.test.ts' }));
    expect(included.ok && included.files.map((file) => file.path)).toEqual(['src/rank.ts']);
    const limited = await searchRepo(repo, query('weeklyRank'), { limit: 3 });
    if (!limited.ok) throw new Error(limited.error);
    expect(limited.truncated).toBe(true);
    expect(limited.files.map((file) => file.path)).toEqual(['README.md', 'new.ts']);
    expect(limited.count).toBe(3);
  });

  it('skips a link that leads out of the repository', async () => {
    const repo = await repoWithFiles();
    const outside = await makeTmpDir();
    await writeFile(join(outside, 'secret.txt'), 'weeklyRank\n');
    await symlink(join(outside, 'secret.txt'), join(repo, 'link.txt'));
    const result = await searchRepo(repo, query('weeklyRank'));
    expect(result.ok && result.files.some((file) => file.path === 'link.txt')).toBe(false);
  });

  it('says why a pattern is refused, and stops when asked', async () => {
    const repo = await repoWithFiles();
    expect(await searchRepo(repo, query('a(', { regex: true }))).toEqual({ ok: false, error: 'Not a valid regular expression: unterminated group' });
    expect(await searchRepo(repo, query('weeklyRank'), { stopped: () => true })).toEqual({ ok: false, error: 'Stopped' });
  });
});

describe('replaceInFile', () => {
  it('replaces on the given lines only while the file holds what was searched', async () => {
    const repo = await repoWithFiles();
    const found = await searchRepo(repo, query('weeklyRank'));
    if (!found.ok) throw new Error(found.error);
    const file = found.files.find((candidate) => candidate.path === 'src/rank.ts')!;
    const done = await replaceInFile(repo, 'src/rank.ts', query('weeklyRank'), 'weekRank', file.stamp, [2]);
    expect(done).toEqual({ ok: true, count: 1, stamp: expect.any(String) });
    const text = await readFile(join(repo, 'src', 'rank.ts'), 'utf8');
    expect(text).toBe('const weeklyRank = 1;\nexport { weekRank };\r\nconst other = 2;\n');
    expect(done.ok && done.stamp).toBe(stampOf(text));
    // The old stamp no longer fits: nothing is written.
    expect(await replaceInFile(repo, 'src/rank.ts', query('weeklyRank'), 'x', file.stamp, [1])).toEqual({ ok: false, error: CHANGED, changed: true });
    expect(await readFile(join(repo, 'src', 'rank.ts'), 'utf8')).toBe(text);
  });

  it('refuses a path outside the repository', async () => {
    const repo = await repoWithFiles();
    const result = await replaceInFile(repo, '../x.ts', query('a'), 'b', 'stamp', [1]);
    expect(result.ok).toBe(false);
  });
});
