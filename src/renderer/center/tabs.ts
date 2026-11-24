// Orta panelin sekme mantığı: saf işlevler, durumu değiştirmez, yenisini döner.

/** Orta panelde açılabilen şey: bir dosyanın diff'i ya da içeriği. */
export interface CenterTarget {
  kind: 'diff' | 'file';
  repoPath: string;
  /** Repoya göre göreli yol. */
  path: string;
}

export interface CenterTab extends CenterTarget {
  id: string;
  /** Kalıcı sekme. Önizleme sekmesi (false) bir sonraki tek tıkta yerini yenisine bırakır. */
  pinned: boolean;
}

export interface CenterState {
  tabs: CenterTab[];
  active: string | null;
  /** Panel görünür mü. Kapalıyken sekmeler durur. */
  open: boolean;
}

export const EMPTY_CENTER: CenterState = { tabs: [], active: null, open: false };

export const tabId = (t: CenterTarget) => `${t.kind}:${t.repoPath}:${t.path}`;

/**
 * Tek tık (`pin` false) önizleme sekmesi açar; varsa eskisinin yerine geçer. Çift tık kalıcı
 * yapar. Zaten açık olan bir şey için sekmesine geçilir. Panel kapalıysa açılır.
 */
export function openTarget(s: CenterState, target: CenterTarget, pin: boolean): CenterState {
  const id = tabId(target);
  if (s.tabs.some((tab) => tab.id === id)) {
    const tabs = pin ? s.tabs.map((tab) => (tab.id === id && !tab.pinned ? { ...tab, pinned: true } : tab)) : s.tabs;
    return { tabs, active: id, open: true };
  }
  const tab: CenterTab = { ...target, id, pinned: pin };
  const preview = s.tabs.findIndex((other) => !other.pinned);
  const tabs = preview === -1 ? [...s.tabs, tab] : s.tabs.map((other, index) => (index === preview ? tab : other));
  return { tabs, active: id, open: true };
}

/** Etkin sekme kapanınca sağındaki (yoksa solundaki) öne gelir; son sekmeyle panel de kapanır. */
export function closeCenterTab(s: CenterState, id: string): CenterState {
  const index = s.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return s;
  const tabs = s.tabs.filter((tab) => tab.id !== id);
  if (tabs.length === 0) return EMPTY_CENTER;
  const active = s.active === id ? tabs[Math.min(index, tabs.length - 1)]!.id : s.active;
  return { ...s, tabs, active };
}

export function activateCenterTab(s: CenterState, id: string): CenterState {
  return s.tabs.some((tab) => tab.id === id) ? { ...s, active: id } : s;
}

export function pinCenterTab(s: CenterState, id: string): CenterState {
  if (!s.tabs.some((tab) => tab.id === id && !tab.pinned)) return s;
  return { ...s, tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, pinned: true } : tab)) };
}

/** Paneli gizler ya da gösterir. Gösterilecek sekme yoksa kapalı kalır. */
export function setPanelOpen(s: CenterState, open: boolean): CenterState {
  return { ...s, open: open && s.tabs.length > 0 };
}

/**
 * Çalışma alanı değişince sekmeleri ona uydurur: klasör değiştiyse hepsi kapanır, bir repo
 * kaybolduysa onun sekmeleri kapanır.
 */
export function syncCenter(s: CenterState, prevDir: string | null, dir: string | null, repoPaths: string[]): CenterState {
  if (dir !== prevDir || dir === null) return s.tabs.length === 0 && !s.open ? s : EMPTY_CENTER;
  const known = new Set(repoPaths);
  if (s.tabs.every((tab) => known.has(tab.repoPath))) return s;
  const tabs = s.tabs.filter((tab) => known.has(tab.repoPath));
  if (tabs.length === 0) return EMPTY_CENTER;
  let active = s.active;
  if (!tabs.some((tab) => tab.id === active)) {
    // Etkin sekme gittiyse eski sırada ondan sonraki ilk kalan, yoksa sonuncu.
    const from = s.tabs.findIndex((tab) => tab.id === s.active);
    active = (s.tabs.slice(from + 1).find((tab) => known.has(tab.repoPath)) ?? tabs[tabs.length - 1]!).id;
  }
  return { ...s, tabs, active };
}
