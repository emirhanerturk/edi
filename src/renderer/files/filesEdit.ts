// What the Files tab is typing a name for.
import type { CenterTab } from '../center/tabs';

/** A new file or folder in `parent` ('' is the repo root), or a rename of `path`. */
export type FilesEdit = { mode: 'new'; kind: 'file' | 'dir'; repoPath: string; parent: string } | { mode: 'rename'; repoPath: string; path: string };

/** Open file tabs at or under `path` with unsaved edits: renaming or trashing it loses them. */
export function unsavedUnder(tabs: CenterTab[], unsaved: Record<string, true>, repoPath: string, path: string): number {
  return tabs.filter((tab) => tab.kind === 'file' && tab.repoPath === repoPath && (tab.path === path || tab.path.startsWith(`${path}/`)) && unsaved[tab.id]).length;
}
