import { execFile } from 'node:child_process';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PARTIAL_CLONE, readCommit, splitPatch } from '../src/git/commit.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);
const head = async (repo: string) => (await git(repo, 'rev-parse', 'HEAD')).trim();

async function commitAll(repo: string, message: string[]): Promise<string> {
  await git(repo, 'add', '-A');
  await run('git', ['commit', '-q', ...message.flatMap((m) => ['-m', m])], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: '@1700000000 +0000', GIT_COMMITTER_DATE: '@1700000000 +0000' },
  });
  return head(repo);
}

describe('splitPatch', () => {
  it('starts a new part at each "diff --git" header', () => {
    const patch = ['diff --git a/a b/a', '@@ -1 +1 @@', '-x', '+y', 'diff --git a/b b/b', 'new file mode 100644', '@@ -0,0 +1 @@', '+z', ''].join('\n');
    expect(splitPatch(patch)).toEqual([
      'diff --git a/a b/a\n@@ -1 +1 @@\n-x\n+y\n',
      'diff --git a/b b/b\nnew file mode 100644\n@@ -0,0 +1 @@\n+z\n',
    ]);
  });

  it('does not start a new part at a content line reading "diff --git"', () => {
    const patch = ['diff --git a/a b/a', '@@ -1,2 +1,2 @@', ' diff --git x y', '-x', '+diff --git a b', ''].join('\n');
    expect(splitPatch(patch)).toHaveLength(1);
  });

  it('returns no parts for empty text', () => {
    expect(splitPatch('')).toEqual([]);
  });
});

describe('readCommit', () => {
  it('reads the subject, multi-line body, files and totals', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'README.md'), 'readme\nsecond\n');
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'new.ts'), 'const a = 1;\nconst b = 2;\n');
    const oid = await commitAll(repo, ['feat(app): add the thing', 'First paragraph.\nSame paragraph.', 'Second paragraph.']);

    const result = await readCommit(repo, oid);
    if (!result.ok) throw new Error(result.error);
    const { commit } = result;
    expect(commit).toMatchObject({
      oid,
      short: oid.slice(0, 7),
      subject: 'feat(app): add the thing',
      body: 'First paragraph.\nSame paragraph.\n\nSecond paragraph.',
      authorName: 'Test',
      authorEmail: 'test@example.com',
      date: 1_700_000_000_000,
      parents: 1,
      added: 3,
      removed: 0,
    });
    expect(commit.files.map((f) => [f.letter, f.path, f.origPath, f.diff.added, f.diff.removed])).toEqual([
      ['M', 'README.md', null, 1, 0],
      ['A', 'src/new.ts', null, 2, 0],
    ]);
    expect(commit.files[1]!.diff.hunks[0]!.lines[0]).toEqual({ kind: 'add', newNo: 1, text: 'const a = 1;' });
  });

  it('shows everything as added in a root commit', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const result = await readCommit(repo, await head(repo));
    expect(result.ok && result.commit.files.map((f) => [f.letter, f.path, f.diff.added])).toEqual([['A', 'README.md', 1]]);
    expect(result.ok && result.commit.parents).toBe(0);
  });

  it('shows a merge commit against its first parent', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await git(repo, 'switch', '-q', '-c', 'side');
    await writeFile(join(repo, 'side.txt'), 'side\n');
    await commitAll(repo, ['feat: side']);
    await git(repo, 'switch', '-q', 'main');
    await writeFile(join(repo, 'main.txt'), 'main\n');
    await commitAll(repo, ['feat: main']);
    await git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side');

    const result = await readCommit(repo, await head(repo));
    expect(result.ok && result.commit.parents).toBe(2);
    expect(result.ok && result.commit.files.map((f) => f.path)).toEqual(['side.txt']);
  });

  it('handles a rename, a deletion, a mode-only change and a binary file', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'long.txt'), Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n');
    await writeFile(join(repo, 'to-delete.txt'), 'x\n');
    await writeFile(join(repo, 'script.sh'), 'echo x\n');
    await commitAll(repo, ['chore: prepare']);

    await git(repo, 'mv', 'long.txt', 'new-name.txt');
    await writeFile(join(repo, 'new-name.txt'), Array.from({ length: 20 }, (_, i) => (i === 3 ? 'changed' : `line ${i}`)).join('\n') + '\n');
    await rm(join(repo, 'to-delete.txt'));
    await chmod(join(repo, 'script.sh'), 0o755);
    await writeFile(join(repo, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
    const oid = await commitAll(repo, ['refactor: mixed']);

    const result = await readCommit(repo, oid);
    if (!result.ok) throw new Error(result.error);
    const byPath = Object.fromEntries(result.commit.files.map((f) => [f.path, f]));
    expect(byPath['new-name.txt']).toMatchObject({ letter: 'R', origPath: 'long.txt', diff: { added: 1, removed: 1 } });
    expect(byPath['to-delete.txt']).toMatchObject({ letter: 'D', diff: { added: 0, removed: 1 } });
    expect(byPath['script.sh']).toMatchObject({ letter: 'M', diff: { hunks: [], added: 0, removed: 0 } });
    expect(byPath['image.png']).toMatchObject({ letter: 'A', diff: { binary: true } });
    expect(result.commit.files).toHaveLength(4);
  });

  it('handles paths with spaces, Turkish letters and a leading dash', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'boş klasör'));
    await writeFile(join(repo, 'boş klasör', '-tuhaf ö.txt'), 'one\n');
    const result = await readCommit(repo, await commitAll(repo, ['feat: odd']));
    expect(result.ok && result.commit.files.map((f) => [f.path, f.diff.added])).toEqual([['boş klasör/-tuhaf ö.txt', 1]]);
  });

  it('handles an empty subject and a commit without files', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await git(repo, 'commit', '-q', '--allow-empty', '--allow-empty-message', '-m', '');
    const result = await readCommit(repo, await head(repo));
    expect(result).toMatchObject({ ok: true, commit: { subject: '', body: '', files: [], added: 0, removed: 0 } });
  });

  it("is not affected by the user's diff settings", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, '.gitattributes'), '*.txt diff=fixed\n');
    await writeFile(join(repo, 'a.txt'), 'old\n');
    await commitAll(repo, ['chore: a']);
    await writeFile(join(repo, 'a.txt'), 'new\n');
    const oid = await commitAll(repo, ['fix: a']);
    for (const [key, value] of [
      ['diff.noprefix', 'true'],
      ['diff.mnemonicPrefix', 'true'],
      ['diff.external', 'false'],
      ['color.ui', 'always'],
      ['diff.renames', 'false'],
      ['diff.fixed.textconv', "sh -c 'echo same'"],
      ['log.showSignature', 'true'],
    ] as const) {
      await git(repo, 'config', key, value);
    }
    const result = await readCommit(repo, oid);
    expect(result.ok && result.commit.files.map((f) => [f.path, f.diff.added, f.diff.removed])).toEqual([['a.txt', 1, 1]]);
    expect(result.ok && result.commit.subject).toBe('fix: a');
  });

  it('opens a commit that changes a file type (symlink ↔ file)', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'AGENTS.md'), 'rules\n');
    await writeFile(join(repo, 'CLAUDE.md'), 'old\n');
    await commitAll(repo, ['chore: two files']);
    await rm(join(repo, 'CLAUDE.md'));
    await symlink('AGENTS.md', join(repo, 'CLAUDE.md'));
    await writeFile(join(repo, 'new.txt'), 'x\n');
    const toLink = await commitAll(repo, ['refactor: make CLAUDE.md a symlink']);
    const first = await readCommit(repo, toLink);
    if (!first.ok) throw new Error(first.error);
    expect(first.commit.files.map((f) => [f.letter, f.path, f.diff.added, f.diff.removed])).toEqual([
      ['T', 'CLAUDE.md', 1, 1],
      ['A', 'new.txt', 1, 0],
    ]);

    await rm(join(repo, 'CLAUDE.md'));
    await writeFile(join(repo, 'CLAUDE.md'), 'a file again\n');
    const back = await readCommit(repo, await commitAll(repo, ['revert: back to a file']));
    expect(back.ok && back.commit.files.map((f) => [f.letter, f.path])).toEqual([['T', 'CLAUDE.md']]);
  });

  it('does not fetch missing content or write to .git in a partial clone', async () => {
    const parent = await makeTmpDir();
    const source = await initRepo(parent, 'source', { commit: true });
    await git(source, 'config', 'uploadpack.allowFilter', 'true');
    await writeFile(join(source, 'README.md'), 'second\n');
    await commitAll(source, ['docs: second']);
    const clone = join(parent, 'partial');
    await git(parent, 'clone', '-q', '--filter=blob:none', `file://${source}`, clone);
    const count = async () => (await git(clone, 'count-objects', '-v')).match(/^count: (\d+)/m)?.[1];
    const before = await count();

    const result = await readCommit(clone, await head(clone));
    expect(result).toEqual({ ok: false, error: PARTIAL_CLONE });
    expect(await count()).toBe(before);
    // Reading the list does not need the missing content.
    const { readLog } = await import('../src/git/log.js');
    expect((await readLog(clone, 50)).ok).toBe(true);
    expect(await count()).toBe(before);
  });

  it('skips the diff of a huge commit but shows the files and counts', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'values.json'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n');
    await writeFile(join(repo, 'README.md'), 'readme\nextra\n');
    await writeFile(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0, 0, 1]));
    const oid = await commitAll(repo, ['chore: big data']);

    const result = await readCommit(repo, oid, 500);
    if (!result.ok) throw new Error(result.error);
    expect(result.commit.tooLarge).toBe(true);
    expect(result.commit.files.map((f) => [f.letter, f.path, f.diff.added, f.diff.removed, f.diff.hunks.length, f.diff.binary])).toEqual([
      ['M', 'README.md', 1, 0, 0, false],
      ['A', 'logo.png', 0, 0, 0, true],
      ['A', 'values.json', 200, 0, 0, false],
    ]);
    expect([result.commit.added, result.commit.removed]).toEqual([201, 0]);
    expect((await readCommit(repo, oid)).ok && (await readCommit(repo, oid) as { commit: { tooLarge: boolean } }).commit.tooLarge).toBe(false);
  });
});
