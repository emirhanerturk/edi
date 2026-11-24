import type { WorkspaceView } from '../shared/api';

/** Ev klasörünü `~` ile kısaltır. */
export function tildify(path: string, home: string): string {
  if (home === '' || home === '/') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Durum çubuğundaki sayılar. */
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
 * "Ne kadar önce". Yoklama birkaç saniyede bir çalıştığı için yakın zaman sabit yazılır;
 * sayı ancak yenileme takıldığında görünür.
 */
export function ago(then: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
