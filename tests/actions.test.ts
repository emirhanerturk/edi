import { execFile } from 'node:child_process';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  commit,
  createBranch,
  diffFile,
  fetchRepo,
  listBranches,
  overwriteError,
  pull,
  push,
  pushError,
  stageAll,
  stageFile,
  switchBranch,
  unstageAll,
  unstageFile,
} from '../src/git/actions.js';
import { type FileChange, type RepoStatus, getStatus, hasUnstaged, isStaged } from '../src/git/status.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

async function statusOf(repo: string): Promise<RepoStatus> {
  const r = await getStatus(repo);
  if (!r.ok) throw new Error(r.error);
  return r.status;
}

async function fileOf(repo: string, path: string): Promise<FileChange> {
  const found = (await statusOf(repo)).files.find((f) => f.path === path);
  if (!found) throw new Error(`not in status: ${path}`);
  return found;
}

const newRepo = async (opts: { commit?: boolean } = { commit: true }) => initRepo(await makeTmpDir(), 'a', opts);
const head = async (repo: string) => (await git(repo, 'rev-parse', 'HEAD')).trim();
const commitCount = async (repo: string) => Number((await git(repo, 'rev-list', '--count', 'HEAD')).trim());
const write = async (repo: string, path: string, content: string) => {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), content);
};
const exists = (path: string) => access(path).then(() => true, () => false);

/** A repo with an unfinished merge and an unresolved conflict in README.md. */
async function repoWithConflict() {
  const repo = await newRepo();
  await git(repo, 'switch', '-q', '-c', 'feat/x');
  await write(repo, 'README.md', 'feat/x line\n');
  await git(repo, 'commit', '-q', '-am', 'feat: x');
  await git(repo, 'switch', '-q', 'main');
  await write(repo, 'README.md', 'main line\n');
  await git(repo, 'commit', '-q', '-am', 'feat: main');
  await git(repo, 'merge', 'feat/x').catch(() => undefined); // ends in a conflict
  return repo;
}

/** A repo with an origin that main was pushed to, plus a second clone of the same origin. */
async function repoWithRemoteAndPeer() {
  const repo = await newRepo();
  const bare = await addBareRemote(repo);
  await git(repo, 'push', '-q', '-u', 'origin', 'main');
  const peer = join(await makeTmpDir(), 'peer');
  await git(repo, 'clone', '-q', bare, peer);
  await git(peer, 'config', 'user.name', 'Peer');
  await git(peer, 'config', 'user.email', 'peer@example.com');
  return { repo, bare, peer };
}

/** listBranches with names only, sorted by name: these tests make commits within the same second. */
async function names(repo: string) {
  const list = await listBranches(repo);
  return list.ok ? { ...list, branches: list.branches.map((branch) => branch.name).sort() } : list;
}

/** Commits a new file with the given committer date (unix seconds). */
async function commitAt(repo: string, subject: string, seconds: number) {
  await write(repo, `${seconds}.txt`, `${subject}\n`);
  await git(repo, 'add', '-A');
  await promisify(execFile)('git', ['commit', '-q', '-m', subject], {
    cwd: repo,
    env: { ...process.env, GIT_COMMITTER_DATE: `@${seconds} +0000`, GIT_AUTHOR_DATE: `@${seconds} +0000` },
  });
}

/** Installs a hook script in a work tree's `.git/hooks`, or in a bare repo's `hooks`. */
async function hook(repo: string, name: string, lines: string[]) {
  const dir = (await git(repo, 'rev-parse', '--git-path', 'hooks')).trim();
  const file = join(repo, dir, name);
  await writeFile(file, ['#!/bin/sh', ...lines, ''].join('\n'));
  await chmod(file, 0o755);
}

async function peerPushes(peer: string, name: string) {
  await write(peer, name, 'from the remote\n');
  await git(peer, 'add', '-A');
  await git(peer, 'commit', '-q', '-m', `feat: ${name}`);
  await git(peer, 'push', '-q');
}

describe('stage / unstage', () => {
  it('stages and unstages a file with spaces and Turkish letters', async () => {
    const repo = await newRepo();
    await write(repo, 'boş dosya.txt', 'x\n');

    expect(await stageFile(repo, await fileOf(repo, 'boş dosya.txt'))).toEqual({ ok: true, message: 'Staged' });
    expect(await fileOf(repo, 'boş dosya.txt')).toMatchObject({ x: 'A', y: '.' });

    expect(await unstageFile(repo, await fileOf(repo, 'boş dosya.txt'))).toEqual({
      ok: true,
      message: 'Unstaged',
    });
    expect(await fileOf(repo, 'boş dosya.txt')).toMatchObject({ kind: 'untracked' });
  });

  it('unstages in a repo without commits', async () => {
    const repo = await newRepo({});
    await write(repo, 'first.txt', 'x\n');
    await stageFile(repo, await fileOf(repo, 'first.txt'));

    expect((await unstageFile(repo, await fileOf(repo, 'first.txt'))).ok).toBe(true);
    expect(await fileOf(repo, 'first.txt')).toMatchObject({ kind: 'untracked' });
  });

  it('leaves nothing staged after unstaging a staged rename', async () => {
    const repo = await newRepo();
    await write(repo, 'old name.txt', 'same content\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: file');
    await git(repo, 'mv', 'old name.txt', 'new name.txt');
    const renamed = await fileOf(repo, 'new name.txt');
    expect(renamed).toMatchObject({ x: 'R', origPath: 'old name.txt' });

    expect((await unstageFile(repo, renamed)).ok).toBe(true);
    const files = (await statusOf(repo)).files;
    expect(files.some(isStaged)).toBe(false);
    expect(files.map((f) => f.path).sort()).toEqual(['new name.txt', 'old name.txt']);
  });

  it('stages a deleted file', async () => {
    const repo = await newRepo();
    await rm(join(repo, 'README.md'));

    expect((await stageFile(repo, await fileOf(repo, 'README.md'))).ok).toBe(true);
    expect(await fileOf(repo, 'README.md')).toMatchObject({ x: 'D', y: '.' });
  });

  it('stageAll stages everything and unstageAll unstages everything', async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'changed\n');
    await write(repo, 'new.txt', 'x\n');

    expect((await stageAll(repo)).ok).toBe(true);
    expect((await statusOf(repo)).files.every((f) => isStaged(f) && !hasUnstaged(f))).toBe(true);

    expect((await unstageAll(repo)).ok).toBe(true);
    const files = (await statusOf(repo)).files;
    expect(files).toHaveLength(2);
    expect(files.some(isStaged)).toBe(false);
  });
});

describe('commit', () => {
  it('commits only staged files', async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'changed\n');
    await write(repo, 'a.txt', 'x\n');
    await git(repo, 'add', 'a.txt');

    expect(await commit(repo, 'feat: x', { addAll: false })).toEqual({ ok: true, message: 'Committed' });
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('feat: x\n');
    expect((await statusOf(repo)).files).toEqual([
      { path: 'README.md', origPath: null, x: '.', y: 'M', kind: 'changed' },
    ]);
  });

  it('commits new files too with addAll', async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'changed\n');
    await write(repo, 'new.txt', 'x\n');

    expect((await commit(repo, 'feat: everything', { addAll: true })).ok).toBe(true);
    expect((await statusOf(repo)).files).toEqual([]);
    expect(await commitCount(repo)).toBe(2);
  });

  it('writes a message with Turkish letters as is', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'fix: çökme düzeltildi', { addAll: true });
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('fix: çökme düzeltildi\n');
  });

  it('does not commit with an empty message', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    await git(repo, 'add', '-A');

    expect(await commit(repo, '   ', { addAll: false })).toEqual({ ok: false, error: 'Commit message is empty' });
    expect(await commitCount(repo)).toBe(1);
  });

  it("returns git's explanation when there is nothing to commit", async () => {
    const repo = await newRepo();
    const r = await commit(repo, 'feat: empty', { addAll: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/nothing to commit/);
    expect(await commitCount(repo)).toBe(1);
  });

  it("does not commit when the pre-commit hook rejects and returns the hook's output", async () => {
    const repo = await newRepo();
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'a.txt', 'x\n');

    expect(await commit(repo, 'feat: x', { addAll: true })).toEqual({ ok: false, error: 'lint failed' });
    expect(await commitCount(repo)).toBe(1);
  });
});

describe('index lock', () => {
  it('fails a write while index.lock exists but still reads the status', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    const file = await fileOf(repo, 'a.txt');
    await writeFile(join(repo, '.git', 'index.lock'), '');

    const r = await stageFile(repo, file);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('index.lock');
    expect((await getStatus(repo)).ok).toBe(true);
  });
});

describe('push / pull / fetch', () => {
  it('pushes a branch without an upstream to origin and sets the upstream', async () => {
    const repo = await newRepo();
    const bare = await addBareRemote(repo);
    expect((await statusOf(repo)).upstream).toBeNull();

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: true, message: 'Pushed' });
    expect(await statusOf(repo)).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 });
    expect((await git(bare, 'rev-parse', 'main')).trim()).toBe(await head(repo));
  });

  it('pushes a new commit when an upstream exists', async () => {
    const { repo, bare } = await repoWithRemoteAndPeer();
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'feat: a', { addAll: true });
    expect((await statusOf(repo)).ahead).toBe(1);

    expect((await push(repo, await statusOf(repo))).ok).toBe(true);
    expect((await git(bare, 'rev-parse', 'main')).trim()).toBe(await head(repo));
  });

  it('returns an error without an origin', async () => {
    const repo = await newRepo();
    expect((await push(repo, await statusOf(repo))).ok).toBe(false);
  });

  it('does not push a detached HEAD', async () => {
    const repo = await newRepo();
    await addBareRemote(repo);
    await git(repo, 'checkout', '-q', '--detach');
    expect(await push(repo, await statusOf(repo))).toEqual({ ok: false, error: 'Detached HEAD: cannot push' });
  });

  it('does not force a push rejected because of a remote commit', async () => {
    const { repo, bare, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'remote.txt');
    const remoteHead = (await git(bare, 'rev-parse', 'main')).trim();
    await write(repo, 'local.txt', 'x\n');
    await commit(repo, 'feat: local', { addAll: true });

    const r = await push(repo, await statusOf(repo));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('[rejected]');
    expect((await git(bare, 'rev-parse', 'main')).trim()).toBe(remoteHead);
  });

  it("shows the server's reason when a hook on the remote rejects the push", async () => {
    const { repo, bare } = await repoWithRemoteAndPeer();
    await hook(bare, 'pre-receive', [
      'echo "error: GH006: Protected branch update failed for refs/heads/main." >&2',
      'echo "error: Changes must be made through a pull request." >&2',
      'exit 1',
    ]);
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'feat: a', { addAll: true });

    expect(await push(repo, await statusOf(repo))).toEqual({
      ok: false,
      error: [
        '! [remote rejected] main -> main (pre-receive hook declined)',
        'error: GH006: Protected branch update failed for refs/heads/main.',
        'error: Changes must be made through a pull request.',
      ].join('\n'),
    });
  });

  it('shows the end of the output when the pre-push hook fails', async () => {
    const { repo } = await repoWithRemoteAndPeer();
    await hook(repo, 'pre-push', ['echo "Running tests..."', ...['1', '2', '3', '4', '5', '6'].map((n) => `echo "line ${n}" >&2`), 'exit 1']);
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'feat: a', { addAll: true });

    const r = await push(repo, await statusOf(repo));
    expect(r).toEqual({ ok: false, error: ['The pre-push hook failed:', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'].join('\n') });
  });

  it('a pre-push hook that prints nothing still says it failed', async () => {
    const { repo } = await repoWithRemoteAndPeer();
    await hook(repo, 'pre-push', ['exit 1']);
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'feat: a', { addAll: true });

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: false, error: 'The pre-push hook failed' });
  });

  it('pull fast-forwards', async () => {
    const { repo, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'remote.txt');

    expect(await pull(repo)).toEqual({ ok: true, message: 'Pulled' });
    expect(await head(repo)).toBe(await head(peer));
  });

  it('pull fails on diverged history and leaves HEAD unchanged', async () => {
    const { repo, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'remote.txt');
    await write(repo, 'local.txt', 'x\n');
    await commit(repo, 'feat: local', { addAll: true });
    const before = await head(repo);

    expect((await pull(repo)).ok).toBe(false);
    expect(await head(repo)).toBe(before);
    expect((await statusOf(repo)).files).toEqual([]);
  });

  it('shows the number of commits behind after a fetch', async () => {
    const { repo, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'remote.txt');
    expect((await statusOf(repo)).behind).toBe(0);

    expect(await fetchRepo(repo)).toEqual({ ok: true, message: 'Fetched' });
    expect((await statusOf(repo)).behind).toBe(1);
  });
});

describe('branch', () => {
  it('lists local branches and the current one', async () => {
    const repo = await newRepo();
    await git(repo, 'branch', 'feat/x');
    expect(await names(repo)).toEqual({ ok: true, branches: ['feat/x', 'main'], current: 'main' });
  });

  it('lists the most recently committed branch first, with its date and how far it is from its upstream', async () => {
    const { repo, peer } = await repoWithRemoteAndPeer();
    await peerPushes(peer, 'b.txt');
    await git(repo, 'fetch', '-q');
    await commitAt(repo, 'feat: local', 1_900_000_000);
    await git(repo, 'switch', '-q', '-c', 'feat/new', 'HEAD~1');
    await commitAt(repo, 'feat: newer', 1_900_000_600);
    await git(repo, 'branch', '-q', '--set-upstream-to', 'origin/main');
    const list = await listBranches(repo);
    expect(list).toEqual({
      ok: true,
      current: 'feat/new',
      branches: [
        // Not on origin/main's new commit: 1 ahead, 1 behind.
        { name: 'feat/new', ahead: 1, behind: 1, updatedAt: 1_900_000_600_000 },
        { name: 'main', ahead: 1, behind: 1, updatedAt: 1_900_000_000_000 },
      ],
    });
    // A branch without an upstream has no counts.
    await git(repo, 'branch', '-q', '--unset-upstream');
    const again = await listBranches(repo);
    expect(again.ok && again.branches[0]).toEqual({ name: 'feat/new', ahead: 0, behind: 0, updatedAt: 1_900_000_600_000 });
  });

  it('has no current branch on a detached HEAD', async () => {
    const repo = await newRepo();
    await git(repo, 'checkout', '-q', '--detach');
    expect(await names(repo)).toEqual({ ok: true, branches: ['main'], current: null });
  });

  it('switches to an existing branch and creates a new one', async () => {
    const repo = await newRepo();
    await git(repo, 'branch', 'feat/x');

    expect(await switchBranch(repo, 'feat/x')).toEqual({ ok: true, message: 'Switched to feat/x' });
    expect((await statusOf(repo)).head).toBe('feat/x');

    expect((await createBranch(repo, 'fix/y')).ok).toBe(true);
    expect((await statusOf(repo)).head).toBe('fix/y');
  });

  it('refuses to switch over a conflicting local change and keeps the change', async () => {
    const repo = await newRepo();
    await git(repo, 'switch', '-q', '-c', 'feat/x');
    await write(repo, 'README.md', 'feat/x content\n');
    await git(repo, 'commit', '-q', '-am', 'feat: x');
    await git(repo, 'switch', '-q', 'main');
    await write(repo, 'README.md', 'unsaved local change\n');

    expect((await switchBranch(repo, 'feat/x')).ok).toBe(false);
    expect((await statusOf(repo)).head).toBe('main');
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('unsaved local change\n');
  });

  it('returns an error for an invalid branch name', async () => {
    const repo = await newRepo();
    expect((await createBranch(repo, 'bad name')).ok).toBe(false);
    expect((await statusOf(repo)).head).toBe('main');
  });
});

describe('diff', () => {
  it('returns staged and unstaged changes of a changed file together', async () => {
    const repo = await newRepo();
    await write(repo, 'README.md', 'readme\nstaged line\n');
    await git(repo, 'add', '-A');
    await write(repo, 'README.md', 'readme\nstaged line\nnew line\n');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'README.md'));
    expect(r.ok && r.text).toContain('+staged line');
    expect(r.ok && r.text).toContain('+new line');
  });

  it('returns a new file as all additions and writes its path unescaped', async () => {
    const repo = await newRepo();
    await write(repo, 'boş dosya.txt', 'content\n');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'boş dosya.txt'));
    expect(r.ok && r.text).toContain('+++ b/boş dosya.txt');
    expect(r.ok && r.text).toContain('+content');
  });

  it('returns the diff of a staged file in a repo without commits', async () => {
    const repo = await newRepo({});
    await write(repo, 'first.txt', 'first line\n');
    await git(repo, 'add', '-A');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'first.txt'));
    expect(r.ok && r.text).toContain('+first line');
  });

  it('shows a staged rename as a rename', async () => {
    const repo = await newRepo();
    await git(repo, 'mv', 'README.md', 'READ.md');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'READ.md'));
    expect(r.ok && r.text).toContain('rename from README.md');
  });

  it('returns plain text when color and an external diff tool are configured', async () => {
    const repo = await newRepo();
    await git(repo, 'config', 'color.ui', 'always');
    await git(repo, 'config', 'diff.external', '/usr/bin/false');
    await write(repo, 'README.md', 'readme\nnew line\n');

    const r = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'README.md'));
    expect(r.ok && r.text).toContain('+new line');
    expect(r.ok && r.text).not.toContain('\u001B[');
  });
});

describe('review findings', () => {
  it('unstageAll keeps an unfinished merge', async () => {
    const repo = await newRepo();
    await git(repo, 'switch', '-q', '-c', 'feat/x');
    await write(repo, 'a.txt', 'x\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: a');
    await git(repo, 'switch', '-q', 'main');
    await write(repo, 'b.txt', 'x\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: b');
    await git(repo, 'merge', '--no-commit', '--no-ff', 'feat/x');
    expect(await exists(join(repo, '.git', 'MERGE_HEAD'))).toBe(true);

    expect((await unstageAll(repo)).ok).toBe(true);
    expect((await statusOf(repo)).files.some(isStaged)).toBe(false);
    expect(await exists(join(repo, '.git', 'MERGE_HEAD'))).toBe(true);
  });

  it('does not act on the parent repo for a row whose .git folder is invalid', async () => {
    const outer = await newRepo();
    await write(outer, 'secret.env', 'x\n');
    const inner = join(outer, 'inner');
    await mkdir(join(inner, '.git'), { recursive: true }); // empty .git: not a repo

    expect((await getStatus(inner)).ok).toBe(false);
    expect((await stageAll(inner)).ok).toBe(false);
    expect((await commit(inner, 'feat: x', { addAll: true })).ok).toBe(false);
    expect((await statusOf(outer)).files.some(isStaged)).toBe(false);
    expect(await commitCount(outer)).toBe(1);
  });

  it('does not match other files with a bracketed path', async () => {
    const repo = await newRepo();
    await write(repo, 'app/[slug]/page.tsx', 'a\n');
    await write(repo, 'app/u/page.tsx', 'a\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: pages');
    await write(repo, 'app/[slug]/page.tsx', 'a\nslug changed\n');
    await write(repo, 'app/u/page.tsx', 'a\nu changed\n');

    const diff = await diffFile(repo, await statusOf(repo), await fileOf(repo, 'app/[slug]/page.tsx'));
    expect(diff.ok && diff.text).toContain('+slug changed');
    expect(diff.ok && diff.text).not.toContain('u changed');

    expect((await stageFile(repo, await fileOf(repo, 'app/[slug]/page.tsx'))).ok).toBe(true);
    expect(await fileOf(repo, 'app/[slug]/page.tsx')).toMatchObject({ x: 'M', y: '.' });
    expect(await fileOf(repo, 'app/u/page.tsx')).toMatchObject({ x: '.', y: 'M' });
  });

  it('stages only the file itself for names with a star or a leading colon', async () => {
    const repo = await newRepo();
    await write(repo, '*.txt', 'x\n');
    await write(repo, 'other.txt', 'x\n');
    await write(repo, ':colon.txt', 'x\n');

    expect((await stageFile(repo, await fileOf(repo, '*.txt'))).ok).toBe(true);
    expect(await fileOf(repo, 'other.txt')).toMatchObject({ kind: 'untracked' });
    expect((await stageFile(repo, await fileOf(repo, ':colon.txt'))).ok).toBe(true);
    expect(await fileOf(repo, ':colon.txt')).toMatchObject({ x: 'A' });

    expect((await unstageFile(repo, await fileOf(repo, '*.txt'))).ok).toBe(true);
    expect(await fileOf(repo, ':colon.txt')).toMatchObject({ x: 'A' });
  });

  it('stageAll refuses while a file is conflicted, so the conflict is not marked resolved', async () => {
    const repo = await repoWithConflict();
    expect(await stageAll(repo)).toEqual({ ok: false, error: 'Conflicted files present; resolve them outside edi' });
    expect(await fileOf(repo, 'README.md')).toMatchObject({ kind: 'conflicted' });
  });

  it('refuses to commit everything while a file is conflicted', async () => {
    const repo = await repoWithConflict();
    const before = await commitCount(repo);
    expect(await commit(repo, 'feat: x', { addAll: true })).toEqual({
      ok: false,
      error: 'Conflicted files present; resolve them outside edi',
    });
    expect(await commitCount(repo)).toBe(before);
    expect(await fileOf(repo, 'README.md')).toMatchObject({ kind: 'conflicted' });
  });
});

describe('deferred findings', () => {
  it('lists a branch named like a tag by its short name', async () => {
    const repo = await newRepo();
    await git(repo, 'tag', 'release');
    await git(repo, 'switch', '-q', '-c', 'release');
    expect(await names(repo)).toEqual({ ok: true, branches: ['main', 'release'], current: 'release' });
  });

  it('push republishes a branch whose upstream was deleted', async () => {
    const repo = await newRepo();
    await addBareRemote(repo);
    await git(repo, 'switch', '-q', '-c', 'feat');
    await git(repo, 'push', '-q', '-u', 'origin', 'feat');
    await git(repo, 'push', '-q', 'origin', '--delete', 'feat');
    await write(repo, 'a.txt', 'x\n');
    await commit(repo, 'feat: a', { addAll: true });
    expect(await statusOf(repo)).toMatchObject({ upstream: 'origin/feat', ahead: null });

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: true, message: 'Pushed' });
    expect((await git(repo, 'ls-remote', 'origin', 'refs/heads/feat')).split('\t')[0]).toBe(await head(repo));
    expect(await statusOf(repo)).toMatchObject({ upstream: 'origin/feat', ahead: 0 });
  });

  it('pushes a new branch named like a tag', async () => {
    const repo = await newRepo();
    await addBareRemote(repo);
    await git(repo, 'tag', 'v1');
    await git(repo, 'switch', '-q', '-c', 'v1');

    expect(await push(repo, await statusOf(repo))).toEqual({ ok: true, message: 'Pushed' });
    expect((await git(repo, 'ls-remote', 'origin', 'refs/heads/v1')).split('\t')[0]).toBe(await head(repo));
    expect(await git(repo, 'ls-remote', 'origin', 'refs/tags/v1')).toBe('');
  });

  it('commits a multi-line message with a leading dash and special characters as is', async () => {
    const repo = await newRepo();
    await write(repo, 'a.txt', 'x\n');
    const message = '-m fix: x\n\nbody with "quotes", `ticks` and $(touch pwned)\n# a line starting with a hash\n--amend';

    expect(await commit(repo, `${message}\n\n  `, { addAll: true })).toEqual({ ok: true, message: 'Committed' });
    expect(await git(repo, 'log', '-1', '--format=%B')).toBe(`${message}\n\n`);
    expect(await exists(join(repo, 'pwned'))).toBe(false);
    expect(await commitCount(repo)).toBe(2); // --amend was not read as an option
  });

  it('rejects a branch name starting with a dash', async () => {
    const repo = await newRepo();
    const invalid = { ok: false, error: 'Invalid branch name' };
    expect(await switchBranch(repo, '--detach')).toEqual(invalid);
    expect(await createBranch(repo, '-x')).toEqual(invalid);
    expect(await switchBranch(repo, '')).toEqual(invalid);
    expect(await createBranch(repo, '   ')).toEqual(invalid);
    expect((await git(repo, 'symbolic-ref', 'HEAD')).trim()).toBe('refs/heads/main');
  });

  it('unstageAll refuses while a file is conflicted and keeps the conflict entry', async () => {
    const repo = await repoWithConflict();
    // Add a cleanly merged, staged file next to the conflict.
    await write(repo, 'clean.txt', 'x\n');
    await git(repo, 'add', '--', 'clean.txt');

    expect(await unstageAll(repo)).toEqual({ ok: false, error: 'Conflicted files present; resolve them outside edi' });
    expect(await fileOf(repo, 'README.md')).toMatchObject({ kind: 'conflicted' });
    expect(await fileOf(repo, 'clean.txt')).toMatchObject({ x: 'A' });
  });

  it('restores the index when "commit everything" fails with nothing staged', async () => {
    const repo = await newRepo();
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'README.md', 'broken\n');
    await write(repo, 'new.txt', 'x\n');

    const result = await commit(repo, 'feat: x', { addAll: true });
    expect(result.ok).toBe(false);
    expect(await commitCount(repo)).toBe(1);
    // The old version of the fixed file must not stay in the index and slip into the next commit.
    expect((await statusOf(repo)).files.some(isStaged)).toBe(false);
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('broken\n'); // the working tree is untouched
    expect(await fileOf(repo, 'new.txt')).toMatchObject({ kind: 'untracked' });
  });

  it('leaves the index alone when a commit fails with files already staged', async () => {
    const repo = await newRepo();
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'README.md', 'changed\n');
    await git(repo, 'add', '--', 'README.md');
    await write(repo, 'new.txt', 'x\n');

    expect((await commit(repo, 'feat: x', { addAll: false })).ok).toBe(false);
    expect(await fileOf(repo, 'README.md')).toMatchObject({ x: 'M', y: '.' });
    expect(await fileOf(repo, 'new.txt')).toMatchObject({ kind: 'untracked' });
  });

  it('empties the index when "commit everything" fails in a repo without commits', async () => {
    const repo = await newRepo({ commit: false });
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await write(repo, 'first.txt', 'x\n');

    expect((await commit(repo, 'feat: x', { addAll: true })).ok).toBe(false);
    expect(await fileOf(repo, 'first.txt')).toMatchObject({ kind: 'untracked' });
  });
});

describe('refusals because of local changes', () => {
  it('a switch names the files that would be overwritten', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await git(repo, 'switch', '-q', '-c', 'feat/x');
    await writeFile(join(repo, 'README.md'), 'feat/x line\n');
    await git(repo, 'commit', '-q', '-am', 'feat: x');
    await git(repo, 'switch', '-q', 'main');
    await writeFile(join(repo, 'README.md'), 'local edit\n');
    expect(await switchBranch(repo, 'feat/x')).toEqual({ ok: false, error: 'Your local changes to README.md would be overwritten by checkout' });
  });

  it('a pull names them too', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const bare = await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    const peer = join(await makeTmpDir(), 'peer');
    await git(repo, 'clone', '-q', bare, peer);
    await git(peer, 'config', 'user.name', 'Peer');
    await git(peer, 'config', 'user.email', 'peer@example.com');
    await writeFile(join(peer, 'README.md'), 'remote line\n');
    await git(peer, 'commit', '-q', '-am', 'feat: remote');
    await git(peer, 'push', '-q');
    await git(repo, 'fetch', '-q');
    await writeFile(join(repo, 'README.md'), 'local edit\n');
    expect(await pull(repo)).toEqual({ ok: false, error: 'Your local changes to README.md would be overwritten by merge' });
  });

  it('reads untracked files and long lists; anything else is left to the usual error line', () => {
    expect(overwriteError('error: The following untracked working tree files would be overwritten by checkout:\n\tx.txt\nPlease move')).toBe(
      'The untracked file x.txt would be overwritten by checkout',
    );
    expect(overwriteError('error: Your local changes to the following files would be overwritten by merge:\n\ta\n\tb\n\tc\n\td\n\te\nPlease')).toBe(
      'Your local changes to a, b, c and 2 more would be overwritten by merge',
    );
    expect(overwriteError('fatal: Not possible to fast-forward, aborting.')).toBeNull();
  });
});

describe('pushError', () => {
  it("drops the remote's progress lines and the padding after its messages", () => {
    const stderr = [
      'remote: Resolving deltas: 100% (2/2), done.        ',
      'remote: error: GH013: Repository rule violations found for refs/heads/main.        ',
      'remote:        ',
      'remote: - Cannot update this protected ref.        ',
      'To github.com:me/app.git',
      ' ! [remote rejected] main -> main (push declined due to repository rule violations)',
      "error: failed to push some refs to 'github.com:me/app.git'",
    ].join('\n');
    expect(pushError(stderr)).toBe(
      [
        '! [remote rejected] main -> main (push declined due to repository rule violations)',
        'error: GH013: Repository rule violations found for refs/heads/main.',
        '- Cannot update this protected ref.',
      ].join('\n'),
    );
  });

  it("leaves git's own errors to the usual error line", () => {
    expect(pushError(" ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'x'\nhint: pull first")).toBeNull();
    expect(pushError("error: src refspec main does not match any\nerror: failed to push some refs to 'x'")).toBeNull();
    expect(pushError("fatal: 'origin' does not appear to be a git repository")).toBeNull();
  });
});
