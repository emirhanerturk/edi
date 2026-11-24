// Git sekmesinin saf mantığı: durumdan düğmelere, gruplara ve etiketlere.
import type { FileChange, RepoStatus } from '../../git/types';

export type SyncAction = { kind: 'pull' | 'push' | 'publish'; label: string } | null;

/** Kapalı repo satırındaki tek eşitleme düğmesi. */
export function syncAction(s: RepoStatus, hasRemote = true): SyncAction {
  if (s.detached || s.unborn) return null;
  // Hem ileride hem gerideyse önce almak gerekir.
  if ((s.behind ?? 0) > 0) return { kind: 'pull', label: `Pull ${s.behind}` };
  if ((s.ahead ?? 0) > 0) return { kind: 'push', label: `Push ${s.ahead}` };
  // Upstream hiç yok ya da uzakta silinmiş. Remote'u olmayan repoda yayınlanacak yer de yoktur.
  if (hasRemote && (s.upstream === null || s.ahead === null)) return { kind: 'publish', label: 'Publish branch' };
  return null;
}

export type Group = 'conflicts' | 'staged' | 'changes';

export interface FileGroups {
  conflicts: FileChange[];
  staged: FileChange[];
  changes: FileChange[];
}

const isStaged = (f: FileChange) => f.kind === 'changed' && f.x !== '.';
const hasUnstaged = (f: FileChange) => f.kind === 'untracked' || (f.kind === 'changed' && f.y !== '.');

/** Bir kısmı stage'li dosya hem Staged hem Changes grubunda yer alır. */
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

/** Değişen tekil dosya sayısı. */
export function changeCount(s: RepoStatus): number {
  return s.files.length;
}

/** Dosyanın, gösterildiği gruptaki durum harfi. */
export function letter(f: FileChange, group: Group): string {
  if (f.kind === 'untracked') return '?';
  if (f.kind === 'conflicted') return 'U';
  return group === 'staged' ? f.x : f.y;
}

/** Dosyanın, grup ayrımı olmayan yerlerdeki (sekme, dosya ağacı) harfi: çalışma ağacı durumu, yoksa stage durumu. */
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
  /** Hiçbir şey stage'li değil: commit tüm değişiklikleri alır. */
  all: boolean;
  count: number;
  label: string;
  enabled: boolean;
}

const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** Commit düğmesinin neyi commit edeceği. Çakışma varken commit mümkün değildir. */
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

/** Değişikliği olan repo açık, temiz olan kapalı gelir; kullanıcı elle değiştirdiyse onun tercihi geçerlidir. */
export function isExpanded(status: RepoStatus | null, preference: boolean | undefined): boolean {
  if (!status) return false;
  return preference ?? status.files.length > 0;
}

/** Uzakta yerelde olmayan commit olduğu için reddedilen push: çözümü önce pull etmektir. */
export function isRejectedPush(error: string): boolean {
  return error.includes('[rejected]') || error.includes('fetch first') || error.includes('non-fast-forward');
}
