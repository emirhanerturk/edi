import type { WorkspaceView } from '../shared/api';

/** Shortens the home folder to `~`. */
export function tildify(path: string, home: string): string {
  if (home === '' || home === '/') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
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
