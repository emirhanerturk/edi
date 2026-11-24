// Yalnız tür: sayfa da (Node'a erişimi olmadan) bu dosyayı kullanır.

export interface FileChange {
  path: string;
  /** Rename kaydında dosyanın eski yolu. */
  origPath: string | null;
  /** Index (stage) durumu; değişiklik yoksa '.'. */
  x: string;
  /** Çalışma ağacı durumu; değişiklik yoksa '.'. */
  y: string;
  kind: 'changed' | 'untracked' | 'conflicted';
}

export interface RepoStatus {
  /** Branch adı; detached HEAD'de kısa commit hash'i. */
  head: string;
  /** HEAD commit'inin tam oid'i; henüz commit yoksa null. */
  headOid: string | null;
  detached: boolean;
  /** Repoda henüz hiç commit yok. */
  unborn: boolean;
  upstream: string | null;
  /** Upstream yoksa ya da silinmişse null. */
  ahead: number | null;
  behind: number | null;
  files: FileChange[];
}
