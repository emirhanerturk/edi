import type { Repo } from '../git/discover.js';
import type { FileChange, RepoStatus } from '../git/status.js';

export interface RepoState {
  /** Henüz okunmadıysa ya da okunamadıysa null. */
  status: RepoStatus | null;
  error: string | null;
  /** Süren işlemin etiketi ("push ediliyor…"); yoksa null. */
  busy: string | null;
}

export type Row =
  | { type: 'repo'; key: string; repo: Repo; state: RepoState; expanded: boolean }
  | { type: 'file'; key: string; repo: Repo; file: FileChange };

const UNKNOWN: RepoState = { status: null, error: null, busy: null };

/**
 * Ekrandaki satır listesi. Repo, kullanıcı elle açıp kapatmadıysa (overrides)
 * değişikliği varsa açık, yoksa kapalı gelir.
 */
export function buildRows(
  repos: Repo[],
  states: Record<string, RepoState>,
  overrides: Record<string, boolean>,
): Row[] {
  const rows: Row[] = [];
  for (const repo of repos) {
    const state = states[repo.path] ?? UNKNOWN;
    const files = state.status?.files ?? [];
    const expanded = overrides[repo.path] ?? files.length > 0;
    rows.push({ type: 'repo', key: repo.path, repo, state, expanded });
    if (!expanded) continue;
    for (const file of files) {
      // NUL ne repo yolunda ne dosya yolunda bulunabilir. Tür de anahtarda: `git rm --cached`
      // sonrası aynı yol hem "silindi" hem "yeni dosya" kaydıyla gelir.
      rows.push({ type: 'file', key: `${repo.path}\0${file.kind}\0${file.path}`, repo, file });
    }
  }
  return rows;
}

/** İmleç satır numarasına değil satırın kendisine bağlıdır: liste yenilenince aynı öğede kalır. */
export function resolveCursor(rows: Row[], prevKey: string | null, prevIndex: number): number {
  if (prevKey !== null) {
    const index = rows.findIndex((row) => row.key === prevKey);
    if (index !== -1) return index;
  }
  return Math.max(0, Math.min(prevIndex, rows.length - 1));
}

/** Görünen pencerenin ilk satırı: imleç görünür kalacak şekilde en az kaydırma. */
export function windowTop(count: number, cursor: number, height: number, prevTop: number): number {
  const visible = Math.max(1, height);
  let top = prevTop;
  if (cursor < top) top = cursor;
  else if (cursor >= top + visible) top = cursor - visible + 1;
  return Math.max(0, Math.min(top, Math.max(0, count - visible)));
}

export function repoSummary(state: RepoState): { branch: string; sync: string; changes: string } {
  const { status } = state;
  if (status === null) {
    return { branch: '', sync: '', changes: state.error === null ? 'yükleniyor…' : `! ${state.error}` };
  }

  let sync = '';
  if (!status.detached) {
    if (status.ahead === null || status.behind === null) sync = 'upstream yok';
    else sync = [status.behind > 0 ? `↓${status.behind}` : '', status.ahead > 0 ? `↑${status.ahead}` : ''].filter(Boolean).join(' ');
  }

  const count = status.files.length;
  return { branch: status.head, sync, changes: state.busy ?? (count > 0 ? `● ${count} değişiklik` : '✓ temiz') };
}
