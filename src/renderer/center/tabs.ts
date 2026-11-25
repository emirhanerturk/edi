// The center panel's tab logic: pure functions that don't change the state but return a new one.

/**
 * What can be opened in the center panel: a file's diff, its content, a commit, a stash, or a new file
 * not saved yet (`untitled`: `path` is its name, `repoPath` the repo to suggest when saving, or '').
 */
export interface CenterTarget {
  kind: 'diff' | 'file' | 'commit' | 'stash' | 'untitled';
  repoPath: string;
  /** Path relative to the repo; the full commit ID for a commit or a stash. */
  path: string;
  /** A stash tab's name (its message, or "WIP on main"): its id says nothing. */
  label?: string;
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

/**
 * After a file or folder was renamed (`to`) or moved to the Trash (`to` null): its file tabs, and those
 * of files inside it, follow it to the new path in place, or close.
 */
export function moveFileTabs(s: CenterState, repoPath: string, from: string, to: string | null): CenterState {
  const affected = (tab: CenterTab) => tab.kind === 'file' && tab.repoPath === repoPath && (tab.path === from || tab.path.startsWith(`${from}/`));
  if (!s.tabs.some(affected)) return s;
  let active = s.active;
  const seen = new Set<string>();
  const tabs: CenterTab[] = [];
  for (const tab of s.tabs) {
    let next: CenterTab | null = tab;
    if (affected(tab)) {
      if (to === null) next = null;
      else {
        const path = to + tab.path.slice(from.length);
        next = { ...tab, path, id: tabId({ kind: 'file', repoPath, path }) };
      }
      if (tab.id === s.active) active = next?.id ?? null;
    }
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    tabs.push(next);
  }
  if (tabs.length === 0) return EMPTY_CENTER;
  if (active === null || !tabs.some((tab) => tab.id === active)) {
    // The active tab closed: the nearest tab that stayed, after it first, as when closing it.
    const index = s.tabs.findIndex((tab) => tab.id === s.active);
    const stayed = (tab: CenterTab) => tabs.some((other) => other.id === tab.id);
    const after = s.tabs.slice(index + 1).find(stayed);
    const before = s.tabs.slice(0, Math.max(index, 0)).reverse().find(stayed);
    active = (after ?? before ?? tabs[0]!).id;
  }
  return { ...s, tabs, active };
}

/** A new, empty "Untitled-N" tab (the lowest free N), pinned and active. `repoPath`: where saving starts. */
export function openUntitled(s: CenterState, repoPath: string | null): CenterState {
  const taken = new Set(s.tabs.filter((tab) => tab.kind === 'untitled').map((tab) => tab.path));
  let n = 1;
  while (taken.has(`Untitled-${n}`)) n++;
  const target: CenterTarget = { kind: 'untitled', repoPath: repoPath ?? '', path: `Untitled-${n}` };
  const id = tabId(target);
  return { tabs: [...s.tabs, { ...target, id, pinned: true }], active: id, open: true };
}

/** Puts `target` in the place of tab `id` (an untitled tab once saved); if it's open already, that tab is used. */
export function replaceCenterTab(s: CenterState, id: string, target: CenterTarget): CenterState {
  const index = s.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return s;
  const nextId = tabId(target);
  const wasActive = s.active === id;
  if (s.tabs.some((tab) => tab.id === nextId)) {
    const closed = closeCenterTab(s, id);
    return wasActive ? activateCenterTab(closed, nextId) : closed;
  }
  const tabs = s.tabs.map((tab, i) => (i === index ? { ...target, id: nextId, pinned: true } : tab));
  return { ...s, tabs, active: wasActive ? nextId : s.active };
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
  // An untitled tab doesn't belong to a repo: it stays while the folder does.
  const known = new Set(repoPaths);
  const stays = (tab: CenterTab) => tab.kind === 'untitled' || known.has(tab.repoPath);
  if (s.tabs.every(stays)) return s;
  const tabs = s.tabs.filter(stays);
  if (tabs.length === 0) return EMPTY_CENTER;
  let active = s.active;
  if (!tabs.some((tab) => tab.id === active)) {
    // If the active tab went away: the first remaining one after it in the old order, else the last.
    const from = s.tabs.findIndex((tab) => tab.id === s.active);
    active = (s.tabs.slice(from + 1).find(stays) ?? tabs[tabs.length - 1]!).id;
  }
  return { ...s, tabs, active };
}
