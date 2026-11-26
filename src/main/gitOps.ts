import { commit, createBranch, fetchInBackground, fetchRepo, listBranches, pull, push, stageAll, stageFile, switchBranch, unstageAll, unstageFile } from '../git/actions.js';
import { type IncomingResult, type UnpushedResult, readIncoming, readUnpushed, undoLastCommit } from '../git/unpushed.js';
import { applyStash, dropStash, listStashes, pushStash, readStash, renameStash } from '../git/stash.js';
import { type Trash, discardAll, discardFile } from '../git/discard.js';
import { revertCommit } from '../git/revert.js';
import { getStatus } from '../git/status.js';
import type { BranchList, FileChange, GitOp, OpResult, StashList, StashResult, StashRetry } from '../shared/api.js';
import type { Workspace } from './workspace.js';

export function busyLabel(op: GitOp): string {
  switch (op.op) {
    case 'push':
      return 'Pushing…';
    case 'pull':
      return 'Pulling…';
    case 'fetch':
      return 'Fetching…';
    case 'commit':
      return 'Committing…';
    case 'switch':
    case 'createBranch':
      return 'Switching…';
    case 'undoCommit':
      return 'Undoing commit…';
    case 'revertCommit':
      return 'Reverting…';
    case 'discard':
    case 'discardAll':
      return 'Discarding…';
    case 'stash':
      return 'Stashing…';
    case 'stashPop':
      return 'Popping stash…';
    case 'stashApply':
      return 'Applying stash…';
    case 'stashDrop':
      return 'Dropping stash…';
    case 'stashRename':
      return 'Renaming stash…';
    default:
      return 'Working…';
  }
}

/** After this many automatic fetches fail in a row, a repo is left alone until a fetch, pull or push of the user's succeeds. */
export const BACKGROUND_FAILURES_MAX = 3;

const UNKNOWN_REPO: OpResult = { ok: false, error: 'Unknown repository' };
const INVALID: OpResult = { ok: false, error: 'Invalid operation' };

/** The switch or pull to run again after stashing. */
function isRetry(then: unknown): then is StashRetry {
  if (typeof then !== 'object' || then === null) return false;
  const t = then as Record<string, unknown>;
  return t.op === 'pull' || (t.op === 'switch' && typeof t.branch === 'string');
}

/** A file entry as the page shows it; discarding compares it with a fresh status, so every field matters. */
function isFileChange(f: unknown): f is FileChange {
  if (typeof f !== 'object' || f === null) return false;
  const v = f as Record<string, unknown>;
  return (
    typeof v.path === 'string' &&
    (v.origPath === null || typeof v.origPath === 'string') &&
    typeof v.x === 'string' &&
    typeof v.y === 'string' &&
    (v.kind === 'changed' || v.kind === 'untracked' || v.kind === 'conflicted')
  );
}

/** Whether an operation from the page is well formed. The page isn't trusted: every field is checked. */
function isValidOp(op: unknown): op is GitOp {
  if (typeof op !== 'object' || op === null) return false;
  const o = op as Record<string, unknown>;
  switch (o.op) {
    case 'stageAll':
    case 'unstageAll':
    case 'push':
    case 'pull':
    case 'fetch':
      return true;
    case 'discard':
      return isFileChange(o.file);
    case 'discardAll':
      return Array.isArray(o.files) && o.files.every(isFileChange);
    case 'stage':
    case 'unstage':
      return typeof o.file === 'object' && o.file !== null && typeof (o.file as Record<string, unknown>).path === 'string';
    case 'commit':
      return typeof o.message === 'string' && typeof o.all === 'boolean' && typeof o.push === 'boolean';
    case 'switch':
    case 'createBranch':
      return typeof o.branch === 'string';
    case 'undoCommit':
    case 'revertCommit':
    case 'stashPop':
    case 'stashApply':
    case 'stashDrop':
      return typeof o.oid === 'string';
    case 'stashRename':
      return typeof o.oid === 'string' && typeof o.message === 'string';
    case 'stash':
      // A switch or pull is retried only after stashing everything.
      return typeof o.message === 'string' && typeof o.staged === 'boolean' && (o.then === undefined || (isRetry(o.then) && o.staged === false));
    default:
      return false;
  }
}

/**
 * Runs the git operations the page requests. The repo path is validated against the discovered list,
 * only one operation runs in a repo at a time, and the status is reread after each operation.
 */
export class GitOps {
  private readonly running = new Set<string>();
  /** Automatic fetches in progress, by repo: an operation of the user's waits for its repo's to end. */
  private readonly background = new Map<string, Promise<unknown>>();
  /** Automatic fetches that failed in a row, by repo. */
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly ws: Workspace,
    private readonly deps?: { trash: Trash },
  ) {}

  /** Discarding a new file moves it to the Trash; without one (tests) that fails instead. */
  private readonly trash: Trash = (path) => (this.deps ? this.deps.trash(path) : Promise.reject(new Error('Moving to the Trash is not available')));

  async run(repoPath: string, op: GitOp): Promise<OpResult> {
    const repo = typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
    if (!repo) return UNKNOWN_REPO;
    if (!isValidOp(op)) return INVALID;
    if (this.running.has(repo.path)) return { ok: false, error: 'Another operation is still running' };

    this.running.add(repo.path);
    this.ws.setBusy(repo.path, busyLabel(op));
    try {
      // Two git processes changing the same refs can trip over each other's locks.
      await this.background.get(repo.path);
      const result = await this.execute(repo.path, op);
      // The remote answered the user: the automatic fetch may try again.
      if (result.ok && (op.op === 'fetch' || op.op === 'pull' || op.op === 'push')) this.failures.delete(repo.path);
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      // Status first, then the label: the page sees the current status together with "done". A refresh
      // that fails must not keep the lock and the label (the repo would stay busy for good) or hide the result.
      await this.ws.refresh(repo.path).catch(() => undefined);
      this.running.delete(repo.path);
      this.ws.setBusy(repo.path, null);
    }
  }

  /**
   * The automatic fetch of one repo. Unlike the Fetch button it shows no busy label and no error, holds
   * no lock (an operation started meanwhile waits for it instead of being refused), and is skipped while
   * anything else runs in the repo, or after it kept failing. False when it didn't run.
   */
  async fetchQuietly(repoPath: string): Promise<boolean> {
    const repo = this.ws.repo(repoPath);
    if (!repo?.hasRemote || repo.busy !== null || this.running.has(repo.path) || this.background.has(repo.path)) return false;
    if ((this.failures.get(repo.path) ?? 0) >= BACKGROUND_FAILURES_MAX) return false;
    const job = (async () => {
      const result = await fetchInBackground(repo.path);
      if (!result.ok) {
        this.failures.set(repo.path, (this.failures.get(repo.path) ?? 0) + 1);
        return;
      }
      this.failures.delete(repo.path);
      // The ahead/behind counts come from the remote branches just updated.
      await this.ws.refresh(repo.path);
    })().catch(() => undefined);
    this.background.set(repo.path, job);
    try {
      await job;
    } finally {
      this.background.delete(repo.path);
    }
    return true;
  }

  /** Fetches in every repo that has a remote and no other operation running. */
  async fetchAll(): Promise<{ repoPath: string; result: OpResult }[]> {
    const targets = this.ws.view().repos.filter((repo) => repo.hasRemote && !this.running.has(repo.path));
    return Promise.all(targets.map(async (repo) => ({ repoPath: repo.path, result: await this.run(repo.path, { op: 'fetch' }) })));
  }

  async branches(repoPath: string): Promise<BranchList> {
    const repo = typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
    if (!repo) return { ok: false, error: 'Unknown repository' };
    return listBranches(repo.path);
  }

  async unpushed(repoPath: unknown): Promise<UnpushedResult> {
    const repo = typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
    if (!repo) return { ok: false, error: 'Unknown repository' };
    return readUnpushed(repo.path);
  }

  async incoming(repoPath: unknown): Promise<IncomingResult> {
    const repo = typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
    if (!repo) return { ok: false, error: 'Unknown repository' };
    return readIncoming(repo.path);
  }

  async stashes(repoPath: unknown): Promise<StashList> {
    const repo = typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
    if (!repo) return { ok: false, error: 'Unknown repository' };
    return listStashes(repo.path);
  }

  /** Read-only: the stash view. The id is checked in `readStash`. */
  async stash(repoPath: unknown, oid: unknown): Promise<StashResult> {
    const repo = typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
    if (!repo) return { ok: false, error: 'Unknown repository' };
    return readStash(repo.path, oid);
  }

  private async execute(repo: string, op: GitOp): Promise<OpResult> {
    switch (op.op) {
      case 'stage':
      case 'unstage': {
        // Uses the entry from the repo's current status, not the object the page sent.
        const current = await getStatus(repo);
        if (!current.ok) return { ok: false, error: current.error };
        const file = current.status.files.find((candidate) => candidate.path === op.file.path);
        if (!file) return { ok: false, error: 'File is not in the list of changes' };
        if (file.kind === 'conflicted') return { ok: false, error: 'Conflicted files present; resolve them outside edi' };
        return op.op === 'stage' ? stageFile(repo, file) : unstageFile(repo, file);
      }
      case 'stageAll':
        return stageAll(repo);
      case 'unstageAll':
        return unstageAll(repo);
      case 'commit': {
        const committed = await commit(repo, op.message, { addAll: op.all });
        if (!committed.ok || !op.push) return committed;
        const pushed = await this.push(repo);
        return pushed.ok ? pushed : { ok: false, error: `Committed, but the push failed: ${pushed.error}` };
      }
      case 'push':
        return this.push(repo);
      case 'pull':
        return pull(repo);
      case 'fetch':
        return fetchRepo(repo);
      case 'switch':
        return switchBranch(repo, op.branch);
      case 'createBranch':
        return createBranch(repo, op.branch);
      case 'undoCommit':
        return undoLastCommit(repo, op.oid);
      case 'revertCommit':
        return revertCommit(repo, op.oid);
      case 'discard':
        return discardFile(repo, op.file, this.trash);
      case 'discardAll':
        return discardAll(repo, op.files, this.trash);
      case 'stash': {
        const stashed = await pushStash(repo, { message: op.message, staged: op.staged });
        if (!stashed.ok || !op.then) return stashed;
        this.ws.setBusy(repo, busyLabel(op.then));
        const retried = await this.execute(repo, op.then);
        const what = op.then.op === 'pull' ? 'pull' : 'switch';
        return retried.ok ? retried : { ok: false, error: `Stashed your changes, but the ${what} failed: ${retried.error}` };
      }
      case 'stashPop':
      case 'stashApply':
        return applyStash(repo, op.oid, { drop: op.op === 'stashPop' });
      case 'stashDrop':
        return dropStash(repo, op.oid);
      case 'stashRename':
        return renameStash(repo, op.oid, op.message);
    }
  }

  private async push(repo: string): Promise<OpResult> {
    const current = await getStatus(repo);
    if (!current.ok) return { ok: false, error: current.error };
    return push(repo, current.status);
  }
}
