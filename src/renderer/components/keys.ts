// Keyboard handling shared by lists, trees, tab bars and menus.
import type { KeyboardEvent } from 'react';

/**
 * On a row that opens something: Enter or Space previews it, ⌘Enter opens it in a tab of its own
 * (what a double click does). True if the key was one of them.
 */
export function openKey(event: KeyboardEvent, open: (pin: boolean) => void): boolean {
  if (event.key !== 'Enter' && event.key !== ' ') return false;
  event.preventDefault();
  open(event.key === 'Enter' && event.metaKey);
  return true;
}

/** Where the user is working: the terminals, the center panel, or the side panel (Git, History, Files). */
export type Area = 'terminals' | 'center' | 'side';

/** The panel an event happened in; null outside the three (the title bar, the status bar). */
export function areaOf(target: EventTarget | null): Area | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('.center')) return 'center';
  if (target.closest('.terminals')) return 'terminals';
  if (target.closest('.git')) return 'side';
  return null;
}

export type CloseTarget = { kind: 'terminal'; id: number } | { kind: 'center'; id: string };

/**
 * What ⌘W closes: the active terminal while the user works in the terminals; otherwise the center
 * panel's active tab, as files open there from the side panel too. With the center panel closed,
 * nothing: a terminal is never closed in its place.
 */
export function closeTarget(area: Area, center: { open: boolean; active: string | null }, terminal: number | null): CloseTarget | null {
  if (area === 'terminals') return terminal === null ? null : { kind: 'terminal', id: terminal };
  return center.open && center.active !== null ? { kind: 'center', id: center.active } : null;
}

const typing = (target: EventTarget) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** The element `step` places away from `current` among `items`, wrapping around; the first or last when `current` isn't one of them. */
function stepFrom<T>(items: T[], current: T | null, key: string): T | undefined {
  if (key === 'Home') return items[0];
  if (key === 'End') return items.at(-1);
  const at = current === null ? -1 : items.indexOf(current);
  const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
  if (at === -1) return step === 1 ? items[0] : items.at(-1);
  return items[(at + step + items.length) % items.length];
}

/**
 * On the element holding a menu and its button: Up and Down (Home, End) move the focus among the menu's
 * items; from the button, Down goes to the first item. Typing in a field of the menu is left alone.
 */
export function menuKeys(event: KeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || typing(event.target)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
  if (items.length === 0) return;
  event.preventDefault();
  stepFrom(items, document.activeElement as HTMLElement | null, event.key)?.focus();
}

/**
 * On a tab bar: Left and Right (Home, End) go to the neighbouring tab, which is activated and focused.
 * `ids` are the tabs' in the order of their elements; the step counts from the focused tab.
 */
export function tabKeys(event: KeyboardEvent<HTMLElement>, ids: string[], activate: (id: string) => void): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || ids.length === 0) return;
  const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const focused = elements.findIndex((element) => element.contains(event.target as Node));
  event.preventDefault();
  const next = stepFrom(ids, focused === -1 ? null : (ids[focused] ?? null), event.key);
  if (next === undefined) return;
  activate(next);
  elements[ids.indexOf(next)]?.focus();
}

/**
 * On a tree: Up and Down move between visible rows; Right opens a closed folder or goes into an open one;
 * Left closes an open folder or goes up to the folder holding the row. Folders open and close through
 * their own click. Rows are `[role="treeitem"]` with `data-depth`; `aria-expanded` marks a folder.
 */
export function treeKeys(event: KeyboardEvent<HTMLElement>): void {
  const row = event.target instanceof HTMLElement ? event.target : null;
  if (!row || row.getAttribute('role') !== 'treeitem') return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const at = rows.indexOf(row);
  const expanded = row.getAttribute('aria-expanded');
  const depth = Number(row.dataset.depth);
  let next: HTMLElement | undefined;
  switch (event.key) {
    case 'ArrowDown':
      next = rows[at + 1];
      break;
    case 'ArrowUp':
      next = rows[at - 1];
      break;
    case 'Home':
      next = rows[0];
      break;
    case 'End':
      next = rows.at(-1);
      break;
    case 'ArrowRight':
      if (expanded === 'false') row.click();
      else if (expanded === 'true' && Number(rows[at + 1]?.dataset.depth) > depth) next = rows[at + 1];
      break;
    case 'ArrowLeft':
      if (expanded === 'true') row.click();
      else next = rows.slice(0, at).findLast((candidate) => Number(candidate.dataset.depth) < depth);
      break;
    default:
      return;
  }
  event.preventDefault();
  next?.focus();
}

/** The app's ⌘ shortcuts that close Quick open (`key`: lower case); ⌘P and its own keys, such as ⌘↵, don't. */
export const leavesQuickOpen = (key: string) => /^(?:[otnwf1-9])$/.test(key);
