// Yalnız tür: sayfa da (Node'a erişimi olmadan) bu dosyayı kullanır.
import type { ParsedDiff } from './diffParse.js';

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

/** `ignored`: `.gitignore`'a takılan dosyalar ve klasörler (klasör `/` ile biter, içi yok). */
export type FileList = { ok: true; files: string[]; ignored: string[] } | { ok: false; error: string };

/** Bir klasörün tek seviyesi; `more`: sınır yüzünden gösterilmeyen kayıt sayısı. */
export interface DirEntry {
  name: string;
  dir: boolean;
}
export type DirList = { ok: true; entries: DirEntry[]; more: number } | { ok: false; error: string };

/** Büyük ve ikili dosyaların içeriği sayfaya gönderilmez; yalnız türü ve boyutu döner. */
export type FileContent =
  | { ok: true; kind: 'text'; text: string; size: number }
  | { ok: true; kind: 'binary'; size: number }
  | { ok: true; kind: 'tooLarge'; size: number }
  | { ok: false; error: string };

/** Bir commit'in listede gereken bilgileri. */
export interface CommitSummary {
  oid: string;
  short: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  /** Commit'in (committer) tarihi, epoch ms. */
  date: number;
  /** Ebeveyn sayısı: 0 kök, 2+ merge. */
  parents: number;
  tags: string[];
}

export type LogResult =
  | {
      ok: true;
      /** Yeniden eskiye. */
      commits: CommitSummary[];
      /** İstenenden fazlası var: "Load 50 more" işe yarar. */
      hasMore: boolean;
      /** Yüklenenler arasında henüz push edilmemiş commit'lerin kimlikleri. */
      unpushed: string[];
      /** `origin/main` gibi; yoksa ya da silinmişse null. */
      upstream: string | null;
      /** Reponun `user.email` değeri; ayarlı değilse null. */
      userEmail: string | null;
    }
  | { ok: false; error: string };

export interface CommitFile {
  path: string;
  /** Yeniden adlandırma ya da kopyada eski yol. */
  origPath: string | null;
  letter: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  diff: ParsedDiff;
}

export interface CommitDetail extends CommitSummary {
  /** Diff sınırı aştı: dosyaların satırları yok, yalnız eklenen/silinen sayıları var. */
  tooLarge: boolean;
  /** Konu satırından sonraki metin, sonundaki boşluklar atılmış. */
  body: string;
  files: CommitFile[];
  added: number;
  removed: number;
}

/** `webUrl`: commit push edildiyse GitHub sayfası; yoksa null (okunmadıysa alan yok). */
export type CommitResult = { ok: true; commit: CommitDetail; webUrl?: string | null } | { ok: false; error: string };
