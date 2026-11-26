import type { WorkspaceView } from '../shared/api';

/** Shortens the home folder to `~`. */
export function tildify(path: string, home: string): string {
  if (home === '' || home === '/') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** "182 B", "96.0 KB", "2.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Counts in the status bar. */
export function summary(view: WorkspaceView): { repos: number; withChanges: number; toPush: number } {
  let withChanges = 0;
  let toPush = 0;
  for (const repo of view.repos) {
    if (!repo.status) continue;
    if (repo.status.files.length > 0) withChanges++;
    if ((repo.status.ahead ?? 0) > 0) toPush++;
  }
  return { repos: view.repos.length, withChanges, toPush };
}

/** Age of a commit or branch: "just now", "5m ago", "3h ago", "2d ago", "4mo ago", "2y ago". */
export function age(then: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * "How long ago". Polling runs every few seconds, so the recent past is a fixed string;
 * a number only shows up when refreshing gets stuck.
 */
export function ago(then: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
