import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changesMaterial,
  clip,
  commitMaterial,
  dayMaterial,
  hasStaged,
  incomingMaterial,
  numstatTotals,
  pullRequestMaterial,
  recentSubjects,
  stashMaterial,
} from '../src/git/summaryData.js';
import { GONE } from '../src/git/stash.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

async function commitFile(repo: string, name: string, text: string, message: string) {
  await mkdir(join(repo, name, '..'), { recursive: true });
  await writeFile(join(repo, name), text);
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', message);
  return (await git(repo, 'rev-parse', 'HEAD')).trim();
}

const ok = <T extends { ok: boolean }>(result: T) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as T & { ok: true };
};

describe('helpers', () => {
  it('clip cuts at a line break and says how much was left out', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('line one\nline two\nline three', 20)).toBe('line one\nline two\n[… 11 more characters left out]');
  });

  it('numstat totals count files and lines; binary files count no lines', () => {
    expect(numstatTotals('3\t1\ta.ts\n-\t-\tlogo.png\n10\t0\tb.ts\n')).toEqual({ files: 3, lines: 14 });
  });
});

describe('incomingMaterial', () => {
  it("the upstream's commits not pulled yet, with their change", async () => {
    const dir = await makeTmpDir();
    const repo = await initRepo(dir, 'a', { commit: true });
    const bare = await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    await git(dir, 'clone', '-q', bare, 'b');
    const other = join(dir, 'b');
    await git(other, 'config', 'user.name', 'Berkay');
    await git(other, 'config', 'user.email', 'b@example.com');
    await commitFile(other, 'src/limit.ts', 'export const limit = 3;\n', 'fix(selections): follow the latest count');
    await git(other, 'push', '-q');
    await git(repo, 'fetch', '-q');

    const material = ok(await incomingMaterial(repo));
    expect(material.about).toBe('1 commit');
    expect(material.text).toContain('Pulling from origin/main: 1 commit.');
    expect(material.text).toContain('Author: Berkay');
    expect(material.text).toContain('fix(selections): follow the latest count');
    expect(material.text).toContain('+export const limit = 3;');
  });

  it('nothing without an upstream or with nothing to pull', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    expect(await incomingMaterial(repo)).toEqual({ ok: false, error: 'The branch has no upstream' });
    await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    expect(await incomingMaterial(repo)).toEqual({ ok: false, error: 'Nothing to pull' });
  });
});

describe('changesMaterial', () => {
  it('everything against HEAD with the new files, or the staged changes alone', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'README.md'), 'readme\nmore\n');
    await git(repo, 'add', 'README.md');
    await writeFile(join(repo, 'adSlot.test.tsx'), 'test("fills", () => {});\n');
    expect(await hasStaged(repo)).toBe(true);

    const all = ok(await changesMaterial(repo, { staged: false }));
    expect(all.about).toBe('2 files, 2 lines');
    expect(all.text).toContain('+more');
    expect(all.text).toContain('+test("fills", () => {});');

    const staged = ok(await changesMaterial(repo, { staged: true }));
    expect(staged.about).toBe('1 file, 1 line');
    expect(staged.text).not.toContain('adSlot');
  });

  it('a lock file is listed but its lines stay out of the diff', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await commitFile(repo, 'package-lock.json', '{"v":1}\n', 'chore: lock');
    await writeFile(join(repo, 'package-lock.json'), '{"v":"locked-version-two"}\n');
    const material = ok(await changesMaterial(repo, { staged: false }));
    expect(material.text).toContain('package-lock.json');
    expect(material.text).not.toContain('locked-version-two');
  });

  it('before the first commit, against nothing; and none in a clean repo', async () => {
    const fresh = await initRepo(await makeTmpDir(), 'a');
    await writeFile(join(fresh, 'index.ts'), 'start\n');
    await git(fresh, 'add', '-A');
    expect(ok(await changesMaterial(fresh, { staged: true })).text).toContain('+start');
    expect(await recentSubjects(fresh)).toBe('');
    const clean = await initRepo(await makeTmpDir(), 'b', { commit: true });
    expect(await changesMaterial(clean, { staged: false })).toEqual({ ok: false, error: 'No changes' });
    expect(await recentSubjects(clean)).toBe('chore: init\n');
  });
});

describe('stashMaterial', () => {
  it("a stash's change and its new files; a stash that's gone is refused", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'README.md'), 'readme\nrank badge\n');
    await writeFile(join(repo, 'RankBadge.tsx'), 'export function RankBadge() {}\n');
    await git(repo, 'stash', 'push', '-q', '-u', '-m', 'badge try');
    const oid = (await git(repo, 'rev-parse', 'stash@{0}')).trim();

    const material = ok(await stashMaterial(repo, oid));
    expect(material.text).toContain('Stash: On main: badge try');
    expect(material.text).toContain('+rank badge');
    expect(material.text).toContain('+export function RankBadge() {}');
    expect(material.about).toBe('2 files');
    expect(await stashMaterial(repo, 'f'.repeat(40))).toEqual({ ok: false, error: GONE });
  });
});

describe('pullRequestMaterial', () => {
  /** A repo whose origin has main; a feature branch pushed with one commit, and one more not pushed. */
  async function branchRepo() {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    await git(repo, 'remote', 'set-head', 'origin', 'main');
    await git(repo, 'switch', '-q', '-c', 'feat/rank-badge');
    await commitFile(repo, 'RankBadge.tsx', 'badge\n', 'feat(ranking): show the weekly rank badge');
    await git(repo, 'push', '-q', '-u', 'origin', 'feat/rank-badge');
    await commitFile(repo, 'RankBadge.tsx', 'badge\ndash\n', 'fix(ranking): a dash before the first game');
    return repo;
  }

  it("the branch's commits against the remote's default branch, pushed or not, with GitHub's compare page", async () => {
    const repo = await branchRepo();
    await commitFile(repo, '.github/pull_request_template.md', '## What changes\n\n## Checks\n', 'chore: template');
    await git(repo, 'remote', 'set-url', 'origin', 'git@github.com:emir/quizei-app.git');
    const material = ok(await pullRequestMaterial(repo));
    expect(material.about).toBe('3 commits');
    expect(material.text).toContain('Branch feat/rank-badge, into main: 3 commits.');
    expect(material.text).toContain('## What changes');
    expect(material.text).toContain('feat(ranking): show the weekly rank badge');
    expect(material.compareUrl).toBe('https://github.com/emir/quizei-app/compare/main...feat/rank-badge');
  });

  it('no compare page off GitHub; on the default branch, only what is not pushed yet', async () => {
    const repo = await branchRepo();
    expect(ok(await pullRequestMaterial(repo)).compareUrl).toBeNull();
    await git(repo, 'switch', '-q', 'main');
    await commitFile(repo, 'hotfix.ts', 'fix\n', 'fix: hotfix');
    const onMain = ok(await pullRequestMaterial(repo));
    expect(onMain.text).toContain('Branch main: the 1 commit not pushed yet.');
    expect(onMain.compareUrl).toBeNull();
    await git(repo, 'push', '-q');
    expect(await pullRequestMaterial(repo)).toEqual({ ok: false, error: 'No commits to describe' });
  });
});

describe('commitMaterial', () => {
  it("a commit's message and change; a merge's against its first parent, with the commits it brings", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const root = (await git(repo, 'rev-list', '--max-parents=0', 'HEAD')).trim();
    expect(ok(await commitMaterial(repo, root)).text).toContain('+readme');
    await git(repo, 'switch', '-q', '-c', 'side');
    await commitFile(repo, 'limit.ts', 'limit\n', 'fix: tournaments keep their cap');
    await git(repo, 'switch', '-q', 'main');
    await commitFile(repo, 'other.ts', 'other\n', 'chore: other');
    await git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #174 from berkay/limits', 'side');
    const merge = (await git(repo, 'rev-parse', 'HEAD')).trim();

    const material = ok(await commitMaterial(repo, merge));
    expect(material.about).toBe('1 commit, 1 file');
    expect(material.text).toContain('Merge pull request #174');
    expect(material.text).toContain('<merged-commits>');
    expect(material.text).toContain('fix: tournaments keep their cap');
    expect(material.text).toContain('+limit');
    expect(material.text).not.toContain('+other');
  });
});

describe('dayMaterial', () => {
  it("a day's commits by repository, with what is not pushed yet", async () => {
    const dir = await makeTmpDir();
    const backend = await initRepo(dir, 'quizei-backend', { commit: true });
    const app = await initRepo(dir, 'quizei-app', { commit: true });
    const one = await commitFile(backend, 'limit.ts', 'x\n', 'fix(selections): follow the latest count');
    const two = await commitFile(backend, 'limit.ts', 'y\n', 'chore: drop the backfill');
    const three = await commitFile(app, 'RankBadge.tsx', 'badge\n', 'feat(ranking): show the weekly rank badge');
    const material = ok(
      await dayMaterial('TODAY', [
        { path: backend, name: 'quizei-backend', oids: [two, one], unpushed: [] },
        { path: app, name: 'quizei-app', oids: [three], unpushed: [three] },
      ]),
    );
    expect(material.about).toBe('3 commits in 2 repositories');
    expect(material.text).toContain('The commits of today.');
    expect(material.text).toContain('<repository name="quizei-backend">');
    expect(material.text).toContain(`Not pushed yet: ${three.slice(0, 7)}`);
    expect(material.text).toContain('RankBadge.tsx');
    expect(await dayMaterial('TODAY', [])).toEqual({ ok: false, error: 'No commits that day' });
  });
});
