// The center panel's tab logic: pure functions that don't change the state but return a new one.

/** What can be opened in the center panel: a file's diff, its content or a commit. */
export interface CenterTarget {
  kind: 'diff' | 'file' | 'commit';
  repoPath: string;
  /** Path relative to the repo; the full commit ID for a commit. */
  path: string;
}

export interface CenterTab extends CenterTarget {
  id: string;
  /** Permanent tab. A preview tab (false) gives up its place to a new one on the next single click. */
  pinned: boolean;
}

export interface CenterState {
  tabs: CenterTab[];
  active: string | null;
  /** Whether the panel is visible. The tabs stay while it's closed. */
  open: boolean;
}

export const EMPTY_CENTER: CenterState = { tabs: [], active: null, open: false };

export const tabId = (t: CenterTarget) => `${t.kind}:${t.repoPath}:${t.path}`;

/**
 * A single click (`pin` false) opens a preview tab, replacing the old one if there is one. A double
 * click makes it permanent. For something already open, switches to its tab. Opens the panel if closed.
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

/** When the active tab closes, the one to its right (or else its left) comes forward; the last tab closes the panel too. */
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

/** Hides or shows the panel. Stays closed if there's no tab to show. */
export function setPanelOpen(s: CenterState, open: boolean): CenterState {
  return { ...s, open: open && s.tabs.length > 0 };
}

/**
 * Fits the tabs to a changed workspace: if the folder changed, they all close; if a repo
 * disappeared, its tabs close.
 */
export function syncCenter(s: CenterState, prevDir: string | null, dir: string | null, repoPaths: string[]): CenterState {
  if (dir !== prevDir || dir === null) return s.tabs.length === 0 && !s.open ? s : EMPTY_CENTER;
  const known = new Set(repoPaths);
  if (s.tabs.every((tab) => known.has(tab.repoPath))) return s;
  const tabs = s.tabs.filter((tab) => known.has(tab.repoPath));
  if (tabs.length === 0) return EMPTY_CENTER;
  let active = s.active;
  if (!tabs.some((tab) => tab.id === active)) {
    // If the active tab went away: the first remaining one after it in the old order, else the last.
    const from = s.tabs.findIndex((tab) => tab.id === s.active);
    active = (s.tabs.slice(from + 1).find((tab) => known.has(tab.repoPath)) ?? tabs[tabs.length - 1]!).id;
  }
  return { ...s, tabs, active };
}
