import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getStatus } from '../src/git/status.js';
import {
  APPLIED_WITH_CONFLICTS,
  GONE,
  applyStash,
  dropStash,
  explainRefusal,
  listStashes,
  parseStashList,
  parseStashSubject,
  pushStash,
  readStash,
  renameStash,
  renamedSubject,
  stashMessage,
} from '../src/git/stash.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const porcelain = async (repo: string) => (await git(repo, 'status', '--porcelain')).split('\n').filter(Boolean).sort();
const stashList = async (repo: string) => (await git(repo, 'stash', 'list', '--format=%gs')).split('\n').filter(Boolean);
const oidAt = async (repo: string, index: number) => (await git(repo, 'rev-parse', `stash@{${index}}`)).trim();

/** A repo with one commit (README.md, a.txt) and three kinds of change: staged, unstaged, new. */
async function busyRepo() {
  const repo = await initRepo(await makeTmpDir(), 'r', { commit: true });
  await writeFile(join(repo, 'a.txt'), 'a\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'feat: a');
  await writeFile(join(repo, 'README.md'), 'staged\n');
  await git(repo, 'add', 'README.md');
  await writeFile(join(repo, 'a.txt'), 'unstaged\n');
  await writeFile(join(repo, 'new.txt'), 'new\n');
  return repo;
}

describe('parseStashSubject', () => {
  it("reads git's default line, a message, a detached HEAD and other lines", () => {
    expect(parseStashSubject('WIP on feat/x: 1a2b3c4 feat: add login')).toEqual({ message: null, branch: 'feat/x', baseSubject: 'feat: add login' });
    expect(parseStashSubject('On main: fix: spacing: mobile')).toEqual({ message: 'fix: spacing: mobile', branch: 'main', baseSubject: null });
    expect(parseStashSubject('WIP on (no branch): 1a2b3c4 x')).toEqual({ message: null, branch: null, baseSubject: 'x' });
    expect(parseStashSubject('autostash')).toEqual({ message: 'autostash', branch: null, baseSubject: null });
  });
});

describe('parseStashList', () => {
  it('numbers the records by position and spots the new-files parent', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const out = `${a}\x1fp1 p2 p3\x1f100\x1fOn main: one\0\n${b}\x1fp1 p2\x1f200\x1fWIP on main: 1234567 base\0`;
    expect(parseStashList(out)).toEqual([
      { oid: a, index: 0, subject: 'On main: one', message: 'one', branch: 'main', baseSubject: null, date: 100_000, untracked: true },
      { oid: b, index: 1, subject: 'WIP on main: 1234567 base', message: null, branch: 'main', baseSubject: 'base', date: 200_000, untracked: false },
    ]);
  });
});

describe('stashMessage', () => {
  it('keeps one line and cuts a long one', () => {
    expect(stashMessage('  first\nsecond\r\n third  ')).toBe('first second third');
    expect(stashMessage('x'.repeat(300))).toHaveLength(200);
  });
});

describe('pushStash', () => {
  it('stashes staged, unstaged and new files; the repo turns clean and the count shows in the status', async () => {
    const repo = await busyRepo();
    expect(await pushStash(repo, { message: 'wip: login form', staged: false })).toEqual({ ok: true, message: 'Stashed' });
    expect(await porcelain(repo)).toEqual([]);
    expect(await stashList(repo)).toEqual(['On main: wip: login form']);
    const status = await getStatus(repo);
    expect(status.ok && status.status.stashes).toBe(1);
    const list = await listStashes(repo);
    expect(list.ok && list.stashes.map((s) => [s.index, s.message, s.branch, s.untracked])).toEqual([[0, 'wip: login form', 'main', true]]);
  });

  it("without a message git writes its own line; a message starting with '-' stays a message", async () => {
    const repo = await busyRepo();
    expect((await pushStash(repo, { message: '  ', staged: false })).ok).toBe(true);
    await writeFile(join(repo, 'b.txt'), 'b\n');
    expect((await pushStash(repo, { message: '--staged', staged: false })).ok).toBe(true);
    expect(await stashList(repo)).toEqual(['On main: --staged', 'WIP on main: ' + (await git(repo, 'log', '-1', '--format=%h %s')).trim()]);
  });

  it('stashes only the staged changes with staged', async () => {
    const repo = await busyRepo();
    expect(await pushStash(repo, { message: '', staged: true })).toEqual({ ok: true, message: 'Stashed' });
    expect(await porcelain(repo)).toEqual([' M a.txt', '?? new.txt']);
  });

  it('refuses before the first commit, during a conflict, and with nothing to stash', async () => {
    const unborn = await initRepo(await makeTmpDir(), 'u');
    await writeFile(join(unborn, 'x.txt'), 'x\n');
    expect(await pushStash(unborn, { message: '', staged: false })).toEqual({ ok: false, error: 'Nothing can be stashed before the first commit' });

    const clean = await initRepo(await makeTmpDir(), 'c', { commit: true });
    expect(await pushStash(clean, { message: '', staged: false })).toEqual({ ok: false, error: 'No changes to stash' });
    await writeFile(join(clean, 'README.md'), 'changed\n');
    expect(await pushStash(clean, { message: '', staged: true })).toEqual({ ok: false, error: 'Nothing is staged' });

    const merging = await conflictedRepo();
    expect(await pushStash(merging, { message: '', staged: false })).toEqual({ ok: false, error: 'Conflicted files present; resolve them outside edi' });
  });

  it('refuses the staged changes alone while a file is partly staged, and changes nothing', async () => {
    const repo = await initRepo(await makeTmpDir(), 'p', { commit: true });
    await writeFile(join(repo, 'w.txt'), 'w\n');
    await git(repo, 'add', 'w.txt');
    await writeFile(join(repo, 'w.txt'), 'w\nmore\n');
    expect(await pushStash(repo, { message: '', staged: true })).toEqual({ ok: false, error: 'A file is partly staged: stash all changes instead' });
    expect(await stashList(repo)).toEqual([]);
    expect(await porcelain(repo)).toEqual(['AM w.txt']);
  });

  it('says so when only a nested repo is left, drops the empty stash git makes and leaves the nested repo alone', async () => {
    const repo = await initRepo(await makeTmpDir(), 'outer', { commit: true });
    const nested = await initRepo(repo, 'nested', { commit: true });
    await writeFile(join(nested, 'local.txt'), 'mine\n');
    // git saves an empty stash here; edi drops it again.
    expect(await pushStash(repo, { message: '', staged: false })).toEqual({ ok: false, error: 'Nothing to stash: git leaves nested repositories alone (nested)' });
    expect(await stashList(repo)).toEqual([]);
    expect(await readFile(join(nested, 'local.txt'), 'utf8')).toBe('mine\n');
    // With a real change next to it, the change is stashed and the nested repo stays.
    await writeFile(join(repo, 'README.md'), 'changed\n');
    expect(await pushStash(repo, { message: '', staged: false })).toEqual({ ok: true, message: 'Stashed' });
    expect(await porcelain(repo)).toEqual(['?? nested/']);
  });
});

/** A repo whose README.md is conflicted (a stash popped onto a commit that changed the same line). */
async function conflictedRepo() {
  const repo = await initRepo(await makeTmpDir(), 'm', { commit: true });
  await writeFile(join(repo, 'README.md'), 'stashed\n');
  await git(repo, 'stash', '-q');
  await writeFile(join(repo, 'README.md'), 'committed\n');
  await git(repo, 'commit', '-q', '-am', 'change');
  await git(repo, 'stash', 'apply', '-q').catch(() => undefined);
  return repo;
}

describe('applyStash', () => {
  it('pop brings everything back as it was, staged files staged, and removes the stash', async () => {
    const repo = await busyRepo();
    const before = await porcelain(repo);
    await pushStash(repo, { message: '', staged: false });
    expect(await applyStash(repo, await oidAt(repo, 0), { drop: true })).toEqual({ ok: true, message: 'Stash popped' });
    expect(await porcelain(repo)).toEqual(before);
    expect(await stashList(repo)).toEqual([]);
  });

  it('apply brings it back and keeps the stash', async () => {
    const repo = await busyRepo();
    await pushStash(repo, { message: 'keep me', staged: false });
    expect(await applyStash(repo, await oidAt(repo, 0), { drop: false })).toEqual({ ok: true, message: 'Stash applied' });
    expect(await porcelain(repo)).toEqual(['?? new.txt', 'M  README.md', ' M a.txt'].sort());
    expect(await stashList(repo)).toEqual(['On main: keep me']);
  });

  it('pops the stash it was asked for, not the newest', async () => {
    const repo = await initRepo(await makeTmpDir(), 'two', { commit: true });
    await writeFile(join(repo, 'first.txt'), '1\n');
    await pushStash(repo, { message: 'first', staged: false });
    await writeFile(join(repo, 'second.txt'), '2\n');
    await pushStash(repo, { message: 'second', staged: false });
    expect((await applyStash(repo, await oidAt(repo, 1), { drop: true })).ok).toBe(true);
    expect(await porcelain(repo)).toEqual(['?? first.txt']);
    expect(await stashList(repo)).toEqual(['On main: second']);
  });

  it('applies without the staged split when that part no longer applies', async () => {
    const repo = await initRepo(await makeTmpDir(), 'idx', { commit: true });
    await writeFile(join(repo, 'README.md'), 'readme\nstaged line\n');
    await git(repo, 'add', 'README.md');
    await pushStash(repo, { message: '', staged: false });
    // The same file is now staged differently: the stash's staged part can't go on top of it.
    await writeFile(join(repo, 'README.md'), 'other\nreadme\n');
    await git(repo, 'commit', '-q', '-am', 'change readme');
    expect(await applyStash(repo, await oidAt(repo, 0), { drop: true })).toEqual({ ok: true, message: 'Stash popped' });
    expect(await porcelain(repo)).toEqual([' M README.md']);
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('other\nreadme\nstaged line\n');
  });

  it('keeps the stash and says so when applying ends in conflicts', async () => {
    const repo = await initRepo(await makeTmpDir(), 'conf', { commit: true });
    await writeFile(join(repo, 'README.md'), 'stashed\n');
    await pushStash(repo, { message: 'mine', staged: false });
    await writeFile(join(repo, 'README.md'), 'committed\n');
    await git(repo, 'commit', '-q', '-am', 'change');
    expect(await applyStash(repo, await oidAt(repo, 0), { drop: true })).toEqual({ ok: false, error: APPLIED_WITH_CONFLICTS });
    expect(await porcelain(repo)).toEqual(['UU README.md']);
    expect(await stashList(repo)).toEqual(['On main: mine']);
    // While the conflict is there, nothing more is applied.
    expect(await applyStash(repo, await oidAt(repo, 0), { drop: false })).toEqual({ ok: false, error: 'Conflicted files present; resolve them outside edi' });
  });

  it("names the files when git refuses to overwrite local changes; nothing changes", async () => {
    const repo = await initRepo(await makeTmpDir(), 'local', { commit: true });
    await writeFile(join(repo, 'README.md'), 'stashed\n');
    await pushStash(repo, { message: '', staged: false });
    await writeFile(join(repo, 'README.md'), 'local\n');
    expect(await applyStash(repo, await oidAt(repo, 0), { drop: true })).toEqual({
      ok: false,
      error: 'Your changes to README.md would be overwritten; commit or stash them first',
    });
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('local\n');
    expect(await stashList(repo)).toHaveLength(1);
  });

  it('refuses before git runs when a new file of the stash is already there, so nothing is half applied', async () => {
    const repo = await initRepo(await makeTmpDir(), 'clash', { commit: true });
    await writeFile(join(repo, 'README.md'), 'stashed\n');
    await mkdir(join(repo, 'notes'));
    await writeFile(join(repo, 'notes', 'todo.txt'), 'stashed\n');
    await pushStash(repo, { message: '', staged: false });
    await mkdir(join(repo, 'notes'));
    await writeFile(join(repo, 'notes', 'todo.txt'), 'mine\n');
    expect(await applyStash(repo, await oidAt(repo, 0), { drop: true })).toEqual({
      ok: false,
      error: 'notes/todo.txt already exists; move it away before applying this stash',
    });
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('readme\n');
    expect(await readFile(join(repo, 'notes', 'todo.txt'), 'utf8')).toBe('mine\n');
    expect(await stashList(repo)).toHaveLength(1);
  });

  it('refuses a malformed id and a stash that is gone', async () => {
    const repo = await busyRepo();
    await pushStash(repo, { message: '', staged: false });
    const oid = await oidAt(repo, 0);
    expect(await applyStash(repo, 'stash@{0}', { drop: true })).toEqual({ ok: false, error: 'Invalid stash' });
    expect(await applyStash(repo, oid.slice(0, 7), { drop: true })).toEqual({ ok: false, error: 'Invalid stash' });
    await git(repo, 'stash', 'drop', '-q');
    expect(await applyStash(repo, oid, { drop: true })).toEqual({ ok: false, error: GONE });
  });
});

describe('explainRefusal', () => {
  it('turns the overwrite refusals into one line with the files', () => {
    const many = 'error: Your local changes to the following files would be overwritten by merge:\n\ta\n\tb\n\tc\n\td\nPlease commit';
    expect(explainRefusal(many)).toBe('Your changes to a, b, c and 1 more would be overwritten; commit or stash them first');
    const untracked = 'error: The following untracked working tree files would be overwritten by merge:\n\tx.txt\nPlease move';
    expect(explainRefusal(untracked)).toBe('x.txt already exists; move it away before applying this stash');
    expect(explainRefusal('error: something else')).toBeNull();
  });
});

describe('dropStash', () => {
  it('drops the stash it was asked for', async () => {
    const repo = await initRepo(await makeTmpDir(), 'd', { commit: true });
    for (const name of ['one', 'two', 'three']) {
      await writeFile(join(repo, `${name}.txt`), `${name}\n`);
      await pushStash(repo, { message: name, staged: false });
    }
    expect(await dropStash(repo, await oidAt(repo, 1))).toEqual({ ok: true, message: 'Stash dropped' });
    expect(await stashList(repo)).toEqual(['On main: three', 'On main: one']);
    expect(await dropStash(repo, 'f'.repeat(40))).toEqual({ ok: false, error: GONE });
  });
});

describe('renamedSubject', () => {
  it("writes git's line with the branch it was made on; a line without one becomes the name alone", () => {
    expect(renamedSubject('WIP on feat/x: 1a2b3c4 feat: add login', 'login form')).toBe('On feat/x: login form');
    expect(renamedSubject('On main: old', 'new: name')).toBe('On main: new: name');
    expect(renamedSubject('WIP on (no branch): 1a2b3c4 x', 'detached')).toBe('On (no branch): detached');
    expect(renamedSubject('autostash', 'kept')).toBe('kept');
  });
});

describe('renameStash', () => {
  /** Three stashes, oldest "one", newest "three"; returns their ids newest first. */
  async function threeStashes() {
    const repo = await initRepo(await makeTmpDir(), 'r', { commit: true });
    for (const name of ['one', 'two', 'three']) {
      await writeFile(join(repo, `${name}.txt`), `${name}\n`);
      await git(repo, 'stash', 'push', '-q', '--include-untracked', '-m', name);
    }
    const oids = [await oidAt(repo, 0), await oidAt(repo, 1), await oidAt(repo, 2)];
    return { repo, oids };
  }

  it('renames a stash in the middle; every stash keeps its commit and its place', async () => {
    const { repo, oids } = await threeStashes();
    expect(await renameStash(repo, oids[1], '  second\nstash  ')).toEqual({ ok: true, message: 'Stash renamed' });
    expect(await stashList(repo)).toEqual(['On main: three', 'On main: second stash', 'On main: one']);
    expect([await oidAt(repo, 0), await oidAt(repo, 1), await oidAt(repo, 2)]).toEqual(oids);
  });

  it("names git's default line, keeping the branch; renames the newest and the oldest", async () => {
    const { repo, oids } = await threeStashes();
    await writeFile(join(repo, 'wip.txt'), 'wip\n');
    await git(repo, 'stash', 'push', '-q', '--include-untracked');
    const wip = await oidAt(repo, 0);
    expect((await renameStash(repo, wip, 'named')).ok).toBe(true);
    expect((await renameStash(repo, oids[2], 'first')).ok).toBe(true);
    expect(await stashList(repo)).toEqual(['On main: named', 'On main: three', 'On main: two', 'On main: first']);
    const listed = await listStashes(repo);
    expect(listed.ok && listed.stashes.map((s) => [s.oid, s.message, s.branch])).toEqual([
      [wip, 'named', 'main'],
      [oids[0], 'three', 'main'],
      [oids[1], 'two', 'main'],
      [oids[2], 'first', 'main'],
    ]);
  });

  it('refuses an empty name, a malformed id and a stash that is gone; nothing changes', async () => {
    const { repo, oids } = await threeStashes();
    expect(await renameStash(repo, oids[1], ' \n ')).toEqual({ ok: false, error: 'The name is empty' });
    expect(await renameStash(repo, oids[1], 42)).toEqual({ ok: false, error: 'Invalid name' });
    expect(await renameStash(repo, 'nope', 'x')).toEqual({ ok: false, error: 'Invalid stash' });
    expect(await renameStash(repo, 'f'.repeat(40), 'x')).toEqual({ ok: false, error: GONE });
    expect(await stashList(repo)).toEqual(['On main: three', 'On main: two', 'On main: one']);
  });
});

describe('readStash', () => {
  it("lists the stash's changes against the commit it was made on, then its new files", async () => {
    const repo = await busyRepo();
    await pushStash(repo, { message: 'look', staged: false });
    const oid = await oidAt(repo, 0);
    const result = await readStash(repo, oid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { stash } = result;
    expect(stash.entry).toMatchObject({ oid, index: 0, message: 'look', branch: 'main', untracked: true });
    expect(stash.short).toBe(oid.slice(0, 7));
    expect(stash.files.map((f) => [f.path, f.letter, f.untracked ?? false])).toEqual([
      ['README.md', 'M', false],
      ['a.txt', 'M', false],
      ['new.txt', 'A', true],
    ]);
    expect([stash.added, stash.removed]).toEqual([3, 2]);
  });

  it('says when the stash is gone', async () => {
    const repo = await busyRepo();
    await pushStash(repo, { message: '', staged: false });
    const oid = await oidAt(repo, 0);
    await git(repo, 'stash', 'drop', '-q');
    expect(await readStash(repo, oid)).toEqual({ ok: false, error: GONE, gone: true });
    expect(await readStash(repo, '../x')).toEqual({ ok: false, error: 'Invalid stash' });
  });
});

describe('listStashes', () => {
  it('is empty without stashes', async () => {
    const repo = await initRepo(await makeTmpDir(), 'e', { commit: true });
    expect(await listStashes(repo)).toEqual({ ok: true, stashes: [] });
  });
});
