// Merges repo logs into a single timeline or into repo groups. Pure functions.
import type { CommitSummary, LogResult } from '../../git/types';
import { dayLabel } from './time';

const DAY = 24 * 60 * 60_000;
/** Commits read per repo per page (same as `PAGE` in the main process). */
export const HISTORY_PAGE = 50;
/** The largest count the main process accepts. */
export const HISTORY_MAX = 5000;

/**
 * When it changes, the repo's log is reread: branch, HEAD (commit, pull, branch switch), upstream
 * and ahead/behind (changes the push arrows and the fetch upstream line).
 */
export function historyKey(repo: { status: { head: string; headOid: string | null; upstream: string | null; ahead: number | null; behind: number | null } | null }): string {
  const s = repo.status;
  return s === null ? '' : [s.head, s.headOid, s.upstream, s.ahead, s.behind].join('|');
}
/** In the By repo layout, a repo whose last commit is newer than this starts expanded. */
export const RECENT_MS = 3 * DAY;

export interface RepoLog {
  repo: { name: string; path: string; ahead: number };
  log: LogResult & { ok: true };
}

export type HistoryRow =
  | { type: 'day'; label: string; first: boolean }
  | {
      type: 'commit';
      repoName: string;
      repoPath: string;
      commit: CommitSummary;
      unpushed: boolean;
      /** The author's name if it differs from the repo's `user.email`; otherwise null. */
      author: string | null;
      merge: boolean;
      /** The first tag that doesn't match the subject line (badge). */
      tag: string | null;
    }
  | { type: 'release'; repoName: string; repoPath: string; commit: CommitSummary; tag: string }
  | { type: 'remote'; upstream: string };

const bare = (value: string) => value.trim().replace(/^v/, '');

/** If a tag matches the subject line (`1.86.0` ↔ `v1.86.0`), the commit is shown as a release row. */
export function isRelease(subject: string, tag: string): boolean {
  return bare(tag) !== '' && bare(subject) === bare(tag);
}

/**
 * The oldest moment to show in the merged list. If a repo has older commits that aren't loaded,
 * nothing older than its oldest loaded commit is shown: otherwise that repo would look empty for that span.
 */
export function boundary(logs: RepoLog[]): number | null {
  let edge: number | null = null;
  for (const { log } of logs) {
    if (!log.hasMore || log.commits.length === 0) continue;
    const oldest = Math.min(...log.commits.map((commit) => commit.date));
    edge = edge === null ? oldest : Math.max(edge, oldest);
  }
  return edge;
}

interface Entry {
  log: RepoLog;
  commit: CommitSummary;
  unpushed: boolean;
}

export function timeline(logs: RepoLog[], now: number, opts: { single: boolean }): HistoryRow[] {
  const edge = boundary(logs);
  const entries: Entry[] = [];
  for (const log of logs) {
    const unpushed = new Set(log.log.unpushed);
    for (const commit of log.log.commits) {
      if (edge === null || commit.date >= edge) entries.push({ log, commit, unpushed: unpushed.has(commit.oid) });
    }
  }
  // The sort is stable: commits at the same moment keep the repo's and git's order.
  entries.sort((a, b) => b.commit.date - a.commit.date);

  const only = opts.single && logs.length === 1 ? logs[0]!.log : null;
  const showRemote = only !== null && only.upstream !== null && entries.some((e) => e.unpushed) && entries.some((e) => !e.unpushed);
  let remoteShown = false;
  let seenUnpushed = false;

  const rows: HistoryRow[] = [];
  let lastDay: string | null = null;
  for (const { log, commit, unpushed } of entries) {
    if (showRemote && !remoteShown && seenUnpushed && !unpushed) {
      rows.push({ type: 'remote', upstream: only.upstream! });
      remoteShown = true;
    }
    seenUnpushed ||= unpushed;
    const day = dayLabel(commit.date, now);
    if (day !== lastDay) {
      rows.push({ type: 'day', label: day, first: rows.length === 0 });
      lastDay = day;
    }
    const base = { repoName: log.repo.name, repoPath: log.repo.path, commit };
    const release = commit.tags.find((tag) => isRelease(commit.subject, tag));
    if (release !== undefined) {
      rows.push({ type: 'release', ...base, tag: release });
      continue;
    }
    const email = log.log.userEmail;
    rows.push({
      type: 'commit',
      ...base,
      unpushed,
      author: email !== null && commit.authorEmail.toLowerCase() !== email.toLowerCase() ? commit.authorName : null,
      merge: commit.parents > 1,
      tag: commit.tags[0] ?? null,
    });
  }
  return rows;
}

export interface RepoGroup {
  repoName: string;
  repoPath: string;
  ahead: number;
  /** Last commit within the last 3 days: starts expanded. */
  open: boolean;
  /** Time of the newest commit; null if there are no commits. */
  latest: number | null;
  /** The three newest commits. */
  commits: CommitSummary[];
}

/** By repo: the repo with the most recent commit on top, repos without commits at the end by name. */
export function byRepo(logs: RepoLog[], now: number): RepoGroup[] {
  const groups = logs.map(({ repo, log }): RepoGroup => {
    const latest = log.commits.length === 0 ? null : Math.max(...log.commits.map((commit) => commit.date));
    return {
      repoName: repo.name,
      repoPath: repo.path,
      ahead: repo.ahead,
      open: latest !== null && now - latest < RECENT_MS,
      latest,
      commits: log.commits.slice(0, 3),
    };
  });
  return groups.sort((a, b) => {
    if (a.latest === null || b.latest === null) {
      if (a.latest !== b.latest) return a.latest === null ? 1 : -1;
      return a.repoName.localeCompare(b.repoName);
    }
    return b.latest - a.latest;
  });
}
