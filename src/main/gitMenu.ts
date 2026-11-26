// The right-click menu of a changed file's row in the Git tab.
import { EDITORS } from '../shared/editors.js';
import type { GitFileMenuAction, GitFileMenuState } from '../shared/api.js';

export interface GitMenuItem {
  id: GitFileMenuAction | null;
  label: string;
  enabled?: boolean;
  /** The key shown beside it; the Git tab handles the key itself. */
  accelerator?: string;
  submenu?: GitMenuItem[];
}

const SEPARATOR: GitMenuItem = { id: null, label: '-' };
const GROUPS: readonly GitFileMenuState['group'][] = ['staged', 'changes', 'conflicts'];

/** The page's description of the row, checked; null if it isn't one. */
export function gitFileMenuState(value: unknown): GitFileMenuState | null {
  if (typeof value !== 'object' || value === null) return null;
  const { group, deleted, untracked, canDiscard } = value as Record<string, unknown>;
  if (!GROUPS.includes(group as GitFileMenuState['group'])) return null;
  return { group: group as GitFileMenuState['group'], deleted: deleted === true, untracked: untracked === true, canDiscard: canDiscard === true };
}

/**
 * What the menu offers: opening the change or the file (or the file in an editor), staging or unstaging,
 * discarding (only unstaged changes; greyed out when it can't run), the paths and Finder. A deleted file
 * can't be opened or shown; a new one has no change to open beyond its content.
 */
export function gitFileMenuItems(state: GitFileMenuState): GitMenuItem[] {
  const items: GitMenuItem[] = [];
  if (!state.untracked) items.push({ id: 'openChanges', label: 'Open Changes' });
  items.push({ id: 'openFile', label: 'Open File', enabled: !state.deleted });
  if (!state.deleted) items.push({ id: null, label: 'Open in', submenu: EDITORS.map((editor) => ({ id: `openIn:${editor.id}` as const, label: editor.name })) });
  items.push(SEPARATOR);
  if (state.group === 'staged') items.push({ id: 'unstage', label: 'Unstage' });
  if (state.group === 'changes') items.push({ id: 'stage', label: 'Stage' });
  if (state.group !== 'staged') items.push({ id: 'discard', label: 'Discard Changes…', enabled: state.canDiscard });
  items.push(
    SEPARATOR,
    { id: 'copyPath', label: 'Copy Path', accelerator: 'Alt+Command+C' },
    { id: 'copyRelativePath', label: 'Copy Relative Path', accelerator: 'Shift+Alt+Command+C' },
    SEPARATOR,
    // A new file has no commits yet.
    { id: 'history', label: 'File History', enabled: !state.untracked },
    { id: 'reveal', label: 'Reveal in Finder', accelerator: 'Alt+Command+R', enabled: !state.deleted },
  );
  return items;
}
