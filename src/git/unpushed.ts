// Commits made but not pushed yet, undoing the newest one (git reset --soft HEAD~1), and the commits
// fetched from the upstream but not pulled yet.
import { runGit } from './exec.js';
import { NO_LAZY_FETCH, PINNED, SUMMARY_FORMAT, parseLog } from './log.js';
import type { ActionResult } from './actions.js';
import type { CommitSummary, IncomingResult, UnpushedResult } from './types.js';

export type { IncomingResult, UnpushedResult };

/** At most this many are listed; the count in the header comes from the status. */
const LIMIT = 50;
const OID = /^[0-9a-f]{40}$/;

async function hasUpstream(repo: string): Promise<boolean> {
  const result = await runGit(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return result.ok && result.stdout.trim() !== '';
}

const undoable = (commit: CommitSummary | undefined) => commit !== undefined && commit.parents === 1;

/** The commits reachable from `from` but not from `not`, newest first (at most LIMIT). */
async function commitsBetween(repo: string, from: string, not: string): Promise<{ ok: true; commits: CommitSummary[] } | { ok: false; error: string }> {
  const log = await runGit(
    repo,
    [...PINNED, 'log', '-z', '--no-color', '--decorate=short', '--abbrev=7', `--format=${SUMMARY_FORMAT}`, `--max-count=${LIMIT}`, from, '--not', not, '--'],
    { env: NO_LAZY_FETCH },
  );
  return log.ok ? { ok: true, commits: parseLog(log.stdout) } : { ok: false, error: log.error };
}

/** The branch's commits that its upstream doesn't have. None without an upstream: "unpushed" can't be told apart then. */
export async function readUnpushed(repo: string): Promise<UnpushedResult> {
  if (!(await hasUpstream(repo))) return { ok: true, commits: [], canUndo: false };
  const read = await commitsBetween(repo, 'HEAD', '@{u}');
  if (!read.ok) return read;
  return { ok: true, commits: read.commits, canUndo: undoable(read.commits[0]) };
}

/**
 * The upstream's commits that the branch doesn't have yet: what a pull would bring, as of the last
 * fetch (a teammate's push, once fetched). None without an upstream.
 */
export async function readIncoming(repo: string): Promise<IncomingResult> {
  if (!(await hasUpstream(repo))) return { ok: true, commits: [] };
  return commitsBetween(repo, '@{u}', 'HEAD');
}

/**
 * Undoes the newest commit: HEAD moves to its parent, its changes stay staged, nothing in the working
 * tree changes. Everything is checked again here, just before running: `oid` must still be HEAD, the
 * commit must not be on the upstream, and it must have exactly one parent.
 */
export async function undoLastCommit(repo: string, oid: unknown): Promise<ActionResult> {
  if (typeof oid !== 'string' || !OID.test(oid)) return { ok: false, error: 'Invalid commit' };
  const head = await runGit(repo, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { okCodes: [0, 1] });
  if (!head.ok) return { ok: false, error: head.error };
  if (head.stdout.trim() !== oid) return { ok: false, error: 'This is no longer the latest commit' };
  if (!(await hasUpstream(repo))) return { ok: false, error: 'The branch has no upstream' };
  // Exit 0: HEAD is already on the upstream; 1: it isn't.
  const onUpstream = await runGit(repo, ['merge-base', '--is-ancestor', 'HEAD', '@{u}'], { env: NO_LAZY_FETCH });
  if (onUpstream.ok) return { ok: false, error: 'This commit was already pushed' };
  const parents = await runGit(repo, ['rev-list', '--parents', '-n', '1', oid]);
  if (!parents.ok) return { ok: false, error: parents.error };
  const count = parents.stdout.trim().split(' ').length - 1;
  if (count === 0) return { ok: false, error: 'The first commit cannot be undone' };
  if (count > 1) return { ok: false, error: 'A merge commit cannot be undone here' };
  const reset = await runGit(repo, ['reset', '--soft', 'HEAD~1']);
  return reset.ok ? { ok: true, message: 'Commit undone; its changes are staged' } : { ok: false, error: reset.error };
}
