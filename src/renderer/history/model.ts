// Repo loglarını tek bir zaman çizelgesinde ya da repo gruplarında birleştirir. Saf işlevler.
import type { CommitSummary, LogResult } from '../../git/types';
import { dayLabel } from './time';

const DAY = 24 * 60 * 60_000;
/** Bir sayfada repo başına okunan commit sayısı (ana süreçteki `PAGE` ile aynı). */
export const HISTORY_PAGE = 50;
/** Ana sürecin kabul ettiği en büyük adet. */
export const HISTORY_MAX = 5000;

/**
 * Değişince reponun logu yeniden okunur: branch, HEAD (commit, pull, branch değişimi), upstream
 * ve ahead/behind (push ok işaretlerini, fetch upstream çizgisini değiştirir).
 */
export function historyKey(repo: { status: { head: string; headOid: string | null; upstream: string | null; ahead: number | null; behind: number | null } | null }): string {
  const s = repo.status;
  return s === null ? '' : [s.head, s.headOid, s.upstream, s.ahead, s.behind].join('|');
}
/** By repo düzeninde son commiti bundan yeni olan repo açık başlar. */
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
      /** Yazar, reponun `user.email`'inden farklıysa adı; değilse null. */
      author: string | null;
      merge: boolean;
      /** Konu satırıyla eşleşmeyen ilk etiket (rozet). */
      tag: string | null;
    }
  | { type: 'release'; repoName: string; repoPath: string; commit: CommitSummary; tag: string }
  | { type: 'remote'; upstream: string };

const bare = (value: string) => value.trim().replace(/^v/, '');

/** Etiket konu satırıyla aynıysa (`1.86.0` ↔ `v1.86.0`) commit bir sürüm satırı olarak gösterilir. */
export function isRelease(subject: string, tag: string): boolean {
  return bare(tag) !== '' && bare(subject) === bare(tag);
}

/**
 * Birleşik listede gösterilecek en eski an. Daha eski commitleri yüklenmemiş bir repo varsa
 * onun yüklenen en eski commitinden eskisi gösterilmez: yoksa o repo o aralıkta boş görünürdü.
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
  // Sıralama kararlıdır: aynı andaki commitler reponun ve git'in sırasını korur.
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
  /** Son commit son 3 günde: açık başlar. */
  open: boolean;
  /** En yeni commitin anı; commit yoksa null. */
  latest: number | null;
  /** En yeni üç commit. */
  commits: CommitSummary[];
}

/** By repo: en son commit atılan repo üstte, commiti olmayanlar adıyla sonda. */
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
