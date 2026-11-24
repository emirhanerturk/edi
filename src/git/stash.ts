// Stashes: listing, stashing, popping, applying and dropping them, and reading one for the stash view.
import { lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { type ActionResult, CONFLICT_ERROR, LOCAL_WRITE_TIMEOUT_MS, fileList, listedUnder } from './actions.js';
import { readCommit } from './commit.js';
import { type GitResult, runGit } from './exec.js';
import { NO_LAZY_FETCH, PINNED } from './log.js';
import { getStatus, hasUnstaged, isStaged } from './status.js';
import type { CommitFile, StashDetail, StashEntry, StashList, StashResult } from './types.js';

export type { StashDetail, StashEntry, StashList, StashResult };

/** The list the page shows holds at most this many; the count in the header comes from the status. */
export const LIST_LIMIT = 100;
/** Finding a stash by id looks further: one pushed from a terminal shifts every position by one. */
const FIND_LIMIT = 1000;
/** A message is kept to one line, and not endlessly long. */
const MAX_MESSAGE = 200;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export const GONE = 'This stash is no longer in the list';
export const APPLIED_WITH_CONFLICTS = 'Applied with conflicts; the stash is kept. Resolve them in your editor.';

const US = '\x1f';
/** The reflog subject goes last: it is the only field that can hold arbitrary text. */
const LIST_FORMAT = ['%H', '%P', '%ct', '%gs'].join('%x1f');

/** git's own lines: "WIP on main: 1a2b3c4 subject" and "On main: message". A branch name can't hold ':'. */
const WIP_LINE = /^WIP on ([^:]+): [0-9a-f]+ (.*)$/s;
const ON_LINE = /^On ([^:]+): (.*)$/s;

const branchOf = (raw: string) => (raw === '(no branch)' ? null : raw);

/** The message, branch and (for a default line) base subject in a stash's reflog subject. */
export function parseStashSubject(subject: string): Pick<StashEntry, 'message' | 'branch' | 'baseSubject'> {
  const wip = WIP_LINE.exec(subject);
  if (wip) return { message: null, branch: branchOf(wip[1]!), baseSubject: wip[2]! };
  const on = ON_LINE.exec(subject);
  if (on) return { message: on[2]!, branch: branchOf(on[1]!), baseSubject: null };
  // Lines git writes elsewhere ("autostash") or `git stash store -m`: the line is the message.
  return { message: subject, branch: null, baseSubject: null };
}

/** Parses `git stash list -z --format=<LIST_FORMAT>`. The position of a record is the stash's index. */
export function parseStashList(out: string): StashEntry[] {
  const entries: StashEntry[] = [];
  let index = 0;
  for (const raw of out.split('\0')) {
    // git sometimes leaves a newline between records.
    const record = raw.replace(/^\n/, '');
    if (record === '') continue;
    const [oid = '', parents = '', time = '0', ...rest] = record.split(US);
    const position = index++;
    if (!OID.test(oid)) continue;
    const subject = rest.join(US);
    entries.push({
      oid,
      index: position,
      subject,
      ...parseStashSubject(subject),
      date: Number(time) * 1000,
      // A stash made with --include-untracked has a third parent holding the new files.
      untracked: parents.split(' ').filter(Boolean).length >= 3,
    });
  }
  return entries;
}

/** The newest stashes (none if there are none). */
export async function listStashes(repo: string, limit = LIST_LIMIT): Promise<StashList> {
  const result = await runGit(repo, [...PINNED, 'stash', 'list', '-z', `--format=${LIST_FORMAT}`, `--max-count=${limit}`], { env: NO_LAZY_FETCH });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, stashes: parseStashList(result.stdout) };
}

type Found = { ok: true; entry: StashEntry } | { ok: false; error: string };

/**
 * The stash with this id and its position right now. Positions shift as stashes come and go, so the
 * position is read again here, just before it is used, and must still name the same commit.
 */
async function findStash(repo: string, oid: unknown): Promise<Found> {
  if (typeof oid !== 'string' || !OID.test(oid)) return { ok: false, error: 'Invalid stash' };
  const list = await listStashes(repo, FIND_LIMIT);
  if (!list.ok) return list;
  const entry = list.stashes.find((stash) => stash.oid === oid);
  if (!entry) return { ok: false, error: GONE };
  const ref = await runGit(repo, ['rev-parse', '--verify', '--quiet', `stash@{${entry.index}}`], { okCodes: [0, 1, 128] });
  if (!ref.ok || ref.stdout.trim() !== oid) return { ok: false, error: GONE };
  return { ok: true, entry };
}

/** The newest stash's id; null when there is none. */
async function newestStash(repo: string): Promise<string | null> {
  const result = await runGit(repo, ['rev-parse', '--verify', '--quiet', 'refs/stash'], { okCodes: [0, 1] });
  const oid = result.ok ? result.stdout.trim() : '';
  return oid === '' ? null : oid;
}

/** One line: line breaks become spaces, and a long message is cut. */
export function stashMessage(message: string): string {
  const line = message.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  return line.length > MAX_MESSAGE ? line.slice(0, MAX_MESSAGE).trimEnd() : line;
}

/**
 * Stashes every change, new files included (`--include-untracked`), or only the staged ones
 * (`--staged`). Ignored files stay. Checked first: there must be a commit to stash on, no conflict,
 * something to stash, and, for the staged changes alone, no partly staged file: git saves the stash
 * and then fails to take such a file's staged half out of the working tree.
 */
export async function pushStash(repo: string, opts: { message: string; staged: boolean }): Promise<ActionResult> {
  const current = await getStatus(repo);
  if (!current.ok) return { ok: false, error: current.error };
  const { files, unborn } = current.status;
  if (unborn) return { ok: false, error: 'Nothing can be stashed before the first commit' };
  if (files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  if (opts.staged) {
    if (!files.some(isStaged)) return { ok: false, error: 'Nothing is staged' };
    if (files.some((f) => isStaged(f) && hasUnstaged(f))) return { ok: false, error: 'A file is partly staged: stash all changes instead' };
  } else if (files.length === 0) return { ok: false, error: 'No changes to stash' };

  const before = await newestStash(repo);
  const message = stashMessage(opts.message);
  const args = ['stash', 'push', opts.staged ? '--staged' : '--include-untracked'];
  // One argument: a message starting with '-' can't be read as an option.
  if (message !== '') args.push(`--message=${message}`);
  const result = await runGit(repo, args, { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
  const after = await newestStash(repo);
  const saved = after !== null && after !== before;
  if (result.ok) {
    // "No local changes to save" exits with 0 too.
    if (!saved) return nothingToStash(files);
    // With only a nested repo left, git saves a stash with nothing in it: that one is ours, and empty, so it goes.
    if (await isEmpty(repo, after)) {
      const found = await findStash(repo, after);
      if (found.ok && found.entry.index === 0) await runGit(repo, ['stash', 'drop', '-q', 'stash@{0}']);
      return nothingToStash(files);
    }
    return { ok: true, message: 'Stashed' };
  }
  if (saved) {
    return { ok: false, error: `The stash was saved, but git could not take the changes out of the working tree: ${result.error}` };
  }
  return { ok: false, error: result.error };
}

/** Why nothing was stashed. With every file listed one by one, a folder entry is a nested repo, which git leaves alone. */
function nothingToStash(files: { path: string; kind: string }[]): ActionResult {
  const nested = files.filter((f) => f.kind === 'untracked' && f.path.endsWith('/')).map((f) => f.path.slice(0, -1));
  if (nested.length > 0 && nested.length === files.length) {
    return { ok: false, error: `Nothing to stash: git leaves nested repositories alone (${fileList(nested)})` };
  }
  return { ok: false, error: 'No local changes to stash' };
}

/** A stash that changes nothing: its working tree and index equal the commit it was made on, and it has no new files. */
async function isEmpty(repo: string, oid: string): Promise<boolean> {
  const trees = await runGit(repo, ['rev-parse', `${oid}^{tree}`, `${oid}^1^{tree}`, `${oid}^2^{tree}`]);
  if (!trees.ok) return false;
  const [work, base, index] = trees.stdout.trim().split('\n');
  if (work !== base || index !== base) return false;
  // No third parent means no new files either; with one, it must be read and be empty.
  const third = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${oid}^3`], { okCodes: [0, 1] });
  if (!third.ok) return false;
  if (third.stdout.trim() === '') return true;
  const untracked = await runGit(repo, ['ls-tree', '--name-only', `${oid}^3`]);
  return untracked.ok && untracked.stdout.trim() === '';
}

/**
 * Whether something is in the way of a new file at `path`: the file itself, or a parent that isn't
 * a folder. Paths are relative to the repo and stay inside it.
 */
async function inTheWay(repo: string, path: string): Promise<boolean> {
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const target = resolve(repo, ...parts.slice(0, i));
    if (!target.startsWith(repo + sep)) return false;
    const stats = await lstat(target).catch(() => null);
    if (stats === null) return false;
    if (i === parts.length || !stats.isDirectory()) return true;
  }
  return false;
}

/**
 * The new files a stash would restore that are already there. git checks them only after applying
 * the tracked changes, and then stops halfway: the tracked part applied, the new files not, the stash
 * kept. So it is checked before git runs.
 */
async function newFilesInTheWay(repo: string, oid: string): Promise<ActionResult | null> {
  const listed = await runGit(repo, ['ls-tree', '-r', '-z', '--name-only', `${oid}^3`], { env: NO_LAZY_FETCH });
  if (!listed.ok) return { ok: false, error: listed.error };
  const taken: string[] = [];
  for (const path of listed.stdout.split('\0').filter(Boolean)) {
    if (await inTheWay(repo, path)) taken.push(path);
  }
  if (taken.length === 0) return null;
  const verb = taken.length === 1 ? 'already exists' : 'already exist';
  return { ok: false, error: `${fileList(taken)} ${verb}; move ${taken.length === 1 ? 'it' : 'them'} away before applying this stash` };
}

/** git's refusal in plain words, with the files it names; null if it is some other error. */
export function explainRefusal(stderr: string): string | null {
  const changed = listedUnder(stderr, /Your local changes to the following files would be overwritten/)?.files;
  if (changed) return `Your changes to ${fileList(changed)} would be overwritten; commit or stash them first`;
  const untracked = listedUnder(stderr, /untracked working tree files would be overwritten/)?.files;
  if (untracked) {
    const verb = untracked.length === 1 ? 'already exists' : 'already exist';
    return `${fileList(untracked)} ${verb}; move ${untracked.length === 1 ? 'it' : 'them'} away before applying this stash`;
  }
  return null;
}

/**
 * Pops (`drop`) or applies a stash. What was staged comes back staged (`--index`); if that part no
 * longer applies, the stash is applied again without it, so only the staged/unstaged split is lost.
 * The stash is never lost: git keeps it on a conflict or a refusal. Refused before git runs while
 * the repo has conflicts, and when a new file of the stash is already there.
 */
export async function applyStash(repo: string, oid: unknown, opts: { drop: boolean }): Promise<ActionResult> {
  const found = await findStash(repo, oid);
  if (!found.ok) return found;
  const { entry } = found;
  const current = await getStatus(repo);
  if (!current.ok) return { ok: false, error: current.error };
  if (current.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  if (entry.untracked) {
    const blocked = await newFilesInTheWay(repo, entry.oid);
    if (blocked) return blocked;
  }

  const verb = opts.drop ? 'pop' : 'apply';
  const ref = `stash@{${entry.index}}`;
  let result: GitResult = await runGit(repo, ['stash', verb, '--index', ref], { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
  // The staged part didn't apply: git stopped before touching anything, so it is tried once more without it.
  if (!result.ok && /conflicts in index/i.test(result.stderr ?? '')) {
    result = await runGit(repo, ['stash', verb, ref], { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
  }
  if (result.ok) return { ok: true, message: opts.drop ? 'Stash popped' : 'Stash applied' };

  const after = await getStatus(repo);
  if (after.ok && after.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: APPLIED_WITH_CONFLICTS };
  return { ok: false, error: explainRefusal(result.stderr ?? '') ?? result.error };
}

/** Deletes a stash. The page asks first. */
export async function dropStash(repo: string, oid: unknown): Promise<ActionResult> {
  const found = await findStash(repo, oid);
  if (!found.ok) return found;
  const result = await runGit(repo, ['stash', 'drop', `stash@{${found.entry.index}}`]);
  return result.ok ? { ok: true, message: 'Stash dropped' } : { ok: false, error: result.error };
}

/**
 * A stash for the stash view: its changes against the commit it was made on (the stash commit's first
 * parent; staged and unstaged together), then its new files (the third parent, a commit of its own).
 */
export async function readStash(repo: string, oid: unknown): Promise<StashResult> {
  if (typeof oid !== 'string' || !OID.test(oid)) return { ok: false, error: 'Invalid stash' };
  const list = await listStashes(repo, FIND_LIMIT);
  if (!list.ok) return list;
  const entry = list.stashes.find((stash) => stash.oid === oid);
  if (!entry) return { ok: false, error: GONE, gone: true };

  const [tracked, base, untrackedOid] = await Promise.all([
    readCommit(repo, entry.oid),
    runGit(repo, [...PINNED, 'log', '-1', '--no-color', '--abbrev=7', '--format=%H%x1f%h%x1f%s', `${entry.oid}^1`, '--'], { env: NO_LAZY_FETCH }),
    entry.untracked ? runGit(repo, ['rev-parse', '--verify', '--quiet', `${entry.oid}^3^{commit}`], { okCodes: [0, 1] }) : null,
  ]);
  if (!tracked.ok) return tracked;
  if (!base.ok) return { ok: false, error: base.error };
  const [baseOid = '', baseShort = '', ...baseSubject] = base.stdout.trim().split(US);

  let files: CommitFile[] = tracked.commit.files;
  let tooLarge = tracked.commit.tooLarge;
  const newFiles = untrackedOid?.ok ? untrackedOid.stdout.trim() : '';
  if (OID.test(newFiles)) {
    const untracked = await readCommit(repo, newFiles);
    if (!untracked.ok) return untracked;
    files = [...files, ...untracked.commit.files.map((file) => ({ ...file, untracked: true as const }))];
    tooLarge ||= untracked.commit.tooLarge;
  }
  const stash: StashDetail = {
    entry,
    short: tracked.commit.short,
    base: { oid: baseOid, short: baseShort, subject: baseSubject.join(US) },
    files,
    added: files.reduce((sum, file) => sum + file.diff.added, 0),
    removed: files.reduce((sum, file) => sum + file.diff.removed, 0),
    tooLarge,
  };
  return { ok: true, stash };
}
