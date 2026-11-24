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

export type FileList = { ok: true; files: string[] } | { ok: false; error: string };

/** Büyük ve ikili dosyaların içeriği sayfaya gönderilmez; yalnız türü ve boyutu döner. */
export type FileContent =
  | { ok: true; kind: 'text'; text: string; size: number }
  | { ok: true; kind: 'binary'; size: number }
  | { ok: true; kind: 'tooLarge'; size: number }
  | { ok: false; error: string };
