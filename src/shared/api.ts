/**
 * Ana süreç ile sayfa arasındaki sözleşme. Yalnız tür içerir: sayfa Node'a erişemez,
 * bu dosyadan çalışan kod almaz.
 */
import type { RepoStatus } from '../git/types.js';

export interface RepoView {
  name: string;
  path: string;
  /** Durum okunamadıysa null; nedeni `error`'da. */
  status: RepoStatus | null;
  error: string | null;
  /** Süren işlemin etiketi ("Pushing…"); yoksa null. */
  busy: string | null;
  /** Bu repoda, bir terminalde açık Claude Code oturumu sayısı. */
  claude: number;
}

export interface WorkspaceView {
  /** Açık klasör; yoksa null. */
  dir: string | null;
  repos: RepoView[];
  /** Klasörün içinde ama hiçbir repoda olmayan Claude Code oturumları. */
  rootSessions: number;
  /** Durumların son okunduğu an (epoch ms). */
  refreshedAt: number;
}

export interface RecentFolder {
  dir: string;
  repoCount: number;
}

export interface Layout {
  left: number;
  right: number;
  diffMode: 'split' | 'inline';
  historyLayout: 'timeline' | 'byRepo';
}

export interface AppState {
  home: string;
  workspace: WorkspaceView;
  recent: RecentFolder[];
  layout: Layout;
}

export type OpenResult = { ok: true } | { ok: false; error: string };

/** Ana sürecin sayfaya kendiliğinden gönderdiği olaylar. */
export interface EdiEvents {
  workspace: [view: WorkspaceView];
  recent: [recent: RecentFolder[]];
}

/** Sayfaya `window.edi` olarak verilen köprü. Görevler ilerledikçe büyür. */
export interface EdiApi {
  getState(): Promise<AppState>;
  /** Sistem klasör seçicisini açar; seçilirse klasör açılır. */
  chooseFolder(): Promise<void>;
  openFolder(dir: string): Promise<OpenResult>;
  rescan(): Promise<void>;
  /** Dönen işlev aboneliği kaldırır. */
  on<K extends keyof EdiEvents>(channel: K, listener: (...args: EdiEvents[K]) => void): () => void;
}
