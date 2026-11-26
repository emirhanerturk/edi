// Reverting a commit: a new commit that undoes it. A revert that stops halfway is aborted at once,
// so the repo is never left in the middle of one.
import { type ActionResult, CONFLICT_ERROR, SLOW_TIMEOUT_MS, overwriteError } from './actions.js';
import { runGit } from './exec.js';
import { operationIn } from './operation.js';
import { gitDirs } from './refsStamp.js';

export const REVERT_CONFLICT = "This commit can't be reverted cleanly: it conflicts with later changes";
export const ALREADY_REVERTED = "This commit's changes are already undone";

/** A full commit id (SHA-1 or SHA-256). It can't start with "-", so it can't be mistaken for an option. */
const OID = /^[0-9a-f]{40,64}$/;

/**
 * `git revert --no-edit <oid>`, with git's own message. Checked first, in order: the commit exists, no
 * merge, rebase, cherry-pick or revert is in progress (one of the user's must never be aborted here),
 * nothing is conflicted, the commit is on the current branch and isn't a merge.
 */
export async function revertCommit(repo: string, oid: unknown): Promise<ActionResult> {
  if (typeof oid !== 'string' || !OID.test(oid)) return { ok: false, error: 'Invalid commit' };
  const resolved = await runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${oid}^{commit}`], { okCodes: [0, 1, 128] });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (resolved.stdout.trim() !== oid) return { ok: false, error: 'Commit not found' };

  const dirs = await gitDirs(repo);
  if (!dirs) return { ok: false, error: 'Not a git repository' };
  const operation = await operationIn(dirs.git);
  if (operation !== null) return { ok: false, error: `A ${operation} is in progress; finish it first` };
  const unmerged = await runGit(repo, ['diff', '--name-only', '--diff-filter=U']);
  if (!unmerged.ok) return { ok: false, error: unmerged.error };
  if (unmerged.stdout.trim() !== '') return { ok: false, error: CONFLICT_ERROR };

  // Exit 0: the commit is in HEAD's history. 1 (it isn't) and any other failure both refuse.
  const onBranch = await runGit(repo, ['merge-base', '--is-ancestor', oid, 'HEAD']);
  if (!onBranch.ok) return { ok: false, error: 'This commit is not on the current branch' };
  const parents = await runGit(repo, ['rev-list', '--parents', '-n', '1', oid]);
  if (!parents.ok) return { ok: false, error: parents.error };
  if (parents.stdout.trim().split(' ').length - 1 > 1) return { ok: false, error: 'A merge commit cannot be reverted here' };

  const reverted = await runGit(repo, ['revert', '--no-edit', oid], { timeoutMs: SLOW_TIMEOUT_MS });
  if (reverted.ok) return { ok: true, message: 'Commit reverted' };
  if ((await operationIn(dirs.git)) === 'revert') {
    const abort = await runGit(repo, ['revert', '--abort']);
    return { ok: false, error: abort.ok ? REVERT_CONFLICT : `${REVERT_CONFLICT}, and undoing the attempt failed: ${abort.error}` };
  }
  if (reverted.stdout.includes('nothing to commit')) return { ok: false, error: ALREADY_REVERTED };
  return { ok: false, error: overwriteError(reverted.stderr ?? '') ?? reverted.error };
}
