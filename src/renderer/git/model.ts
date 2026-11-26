// Pure logic of the Git tab: from state to buttons, groups and labels.
import type { FileChange, RepoStatus, StashEntry } from '../../git/types';

export type SyncAction = { kind: 'pull' | 'push' | 'publish'; label: string } | null;

/** The single sync button on a collapsed repo row. */
export function syncAction(s: RepoStatus, hasRemote = true): SyncAction {
  if (s.detached || s.unborn) return null;
  // If it's both ahead and behind, it has to pull first.
  if ((s.behind ?? 0) > 0) return { kind: 'pull', label: `Pull ${s.behind}` };
  if ((s.ahead ?? 0) > 0) return { kind: 'push', label: `Push ${s.ahead}` };
  // No upstream at all, or it was deleted on the remote. A repo without a remote has nowhere to publish to either.
  if (hasRemote && (s.upstream === null || s.ahead === null)) return { kind: 'publish', label: 'Publish branch' };
  return null;
}

/** What the commit button does instead when there is nothing to commit: what the sync button would. */
export interface NextAction {
  kind: 'pull' | 'push' | 'publish';
  /** "Pull · 4 commits", "Push · 1 commit", "Publish branch". */
  label: string;
  title: string;
}

const commits = (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`;

/** With nothing to commit: pull, push or publish, as the sync button does (pull first when both). Null when up to date. */
export function nextAction(s: RepoStatus, hasRemote = true): NextAction | null {
  if (s.files.length > 0) return null;
  const action = syncAction(s, hasRemote);
  if (!action) return null;
  const upstream = s.upstream ?? 'the remote';
  if (action.kind === 'pull') return { kind: 'pull', label: `Pull · ${commits(s.behind ?? 0)}`, title: `Pull ${commits(s.behind ?? 0)} from ${upstream}` };
  if (action.kind === 'push') return { kind: 'push', label: `Push · ${commits(s.ahead ?? 0)}`, title: `Push ${commits(s.ahead ?? 0)} to ${upstream}` };
  return { kind: 'publish', label: 'Publish branch', title: `Put ${s.head} on the remote and push it` };
}

/** The line under a repo with nothing to commit: what comes after the button's pull, or why it publishes. */
export function cleanNote(s: RepoStatus, hasRemote = true): string {
  const next = nextAction(s, hasRemote);
  if (next?.kind === 'pull' && (s.ahead ?? 0) > 0) return `No changes · ${s.ahead} to push after the pull`;
  if (next?.kind === 'publish') return `No changes · ${s.head} isn't on the remote yet`;
  return 'No changes';
}

export type Group = 'conflicts' | 'staged' | 'changes';

export interface FileGroups {
  conflicts: FileChange[];
  staged: FileChange[];
  changes: FileChange[];
}

const isStaged = (f: FileChange) => f.kind === 'changed' && f.x !== '.';
const hasUnstaged = (f: FileChange) => f.kind === 'untracked' || (f.kind === 'changed' && f.y !== '.');

/** A partially staged file appears in both the Staged and Changes groups. */
export function groupFiles(s: RepoStatus): FileGroups {
  return {
    conflicts: s.files.filter((f) => f.kind === 'conflicted'),
    staged: s.files.filter(isStaged),
    changes: s.files.filter(hasUnstaged),
  };
}

export function isPartlyStaged(f: FileChange): boolean {
  return isStaged(f) && hasUnstaged(f);
}

/** Number of distinct changed files across all repos: the Git tab's badge. */
export function changeTotal(repos: { status: RepoStatus | null }[]): number {
  return repos.reduce((sum, repo) => sum + (repo.status ? changeCount(repo.status) : 0), 0);
}

/** Number of distinct changed files. */
export function changeCount(s: RepoStatus): number {
  return s.files.length;
}

/** The file's status letter in the group it's shown in. */
export function letter(f: FileChange, group: Group): string {
  if (f.kind === 'untracked') return '?';
  if (f.kind === 'conflicted') return 'U';
  return group === 'staged' ? f.x : f.y;
}

/** The file's letter where there are no groups (tab, file tree): the working tree status, else the staged status. */
export function fileLetter(f: FileChange): string {
  if (f.kind === 'untracked') return '?';
  if (f.kind === 'conflicted') return 'U';
  return f.y !== '.' ? f.y : f.x;
}

export function letterColor(l: string): string {
  if (l === 'A' || l === '?') return 'var(--green)';
  if (l === 'D' || l === 'U') return 'var(--red)';
  if (l === 'R' || l === 'C') return 'var(--cyan)';
  return 'var(--yellow)';
}

export function isDeletion(f: FileChange, group: Group): boolean {
  return letter(f, group) === 'D';
}

export function splitPath(p: string): { name: string; dir: string } {
  const slash = p.lastIndexOf('/');
  return slash === -1 ? { name: p, dir: '' } : { name: p.slice(slash + 1), dir: p.slice(0, slash) };
}

export interface CommitTarget {
  /** Nothing is staged: the commit takes all changes. */
  all: boolean;
  count: number;
  label: string;
  enabled: boolean;
}

const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** What the commit button will commit. No commit is possible during a conflict. */
export function commitTarget(g: FileGroups): CommitTarget {
  const blocked = g.conflicts.length > 0;
  if (g.staged.length > 0) {
    return { all: false, count: g.staged.length, label: `Commit · ${files(g.staged.length)}`, enabled: !blocked };
  }
  if (g.changes.length > 0) {
    return { all: true, count: g.changes.length, label: `Commit all · ${files(g.changes.length)}`, enabled: !blocked };
  }
  return { all: false, count: 0, label: 'Commit', enabled: false };
}

/**
 * A repo with changes starts expanded, a clean one collapsed; if the user changed it by hand, their choice wins.
 * When the open folder is this one repo (`single`), stashes expand it too: nothing else is in the panel, and a
 * collapsed row would hide them behind a click.
 */
export function isExpanded(status: RepoStatus | null, preference: boolean | undefined, single = false): boolean {
  if (!status) return false;
  return preference ?? (status.files.length > 0 || (single && status.stashes > 0));
}

type StashText = Pick<StashEntry, 'message' | 'baseSubject' | 'subject' | 'branch'>;

/** How a stash reads in the list: its message, or (git's default line) "WIP" and the subject it was made on. */
export function stashLabel(stash: StashText): { wip: boolean; text: string } {
  if (stash.message !== null && stash.message.trim() !== '') return { wip: false, text: stash.message };
  if (stash.baseSubject !== null) return { wip: true, text: stash.baseSubject };
  return { wip: false, text: stash.subject };
}

/** A stash's name on its own (a tab, a question): its message, or "WIP on <branch>". */
export function stashTitle(stash: StashText): string {
  const { wip, text } = stashLabel(stash);
  if (!wip) return text;
  return stash.branch !== null ? `WIP on ${stash.branch}` : 'WIP';
}

/** Switching or pulling refused because local changes would be overwritten: stashing them first helps. */
export function isBlockedByLocalChanges(error: string): boolean {
  return /would be overwritten by (checkout|merge)/.test(error);
}

/** A push rejected because the remote has commits that aren't local: the fix is to pull first. */
export function isRejectedPush(error: string): boolean {
  return error.includes('[rejected]') || error.includes('fetch first') || error.includes('non-fast-forward');
}
