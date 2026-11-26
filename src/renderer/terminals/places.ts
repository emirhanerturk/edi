// Where a new terminal or Claude Code session can start. Pure.
import type { WorkspaceView } from '../../shared/api';

export interface Place {
  /** The repository's path; null for the project folder. */
  repoPath: string | null;
  name: string;
  /** The branch, or the folder for the project folder. */
  hint: string;
  /** Claude Code sessions open in it now. */
  sessions: number;
}

/** The project folder, then each repository that isn't the folder itself, in the project's order. */
export function tabPlaces(workspace: WorkspaceView, folderHint: string): Place[] {
  const repos = workspace.repos.filter((repo) => repo.path !== workspace.dir);
  return [
    { repoPath: null, name: 'Project folder', hint: folderHint, sessions: workspace.rootSessions },
    ...repos.map((repo) => ({ repoPath: repo.path, name: repo.name, hint: repo.status?.head ?? '', sessions: repo.claude })),
  ];
}

/** ⌥⌘T opens the terminal list, ⌥⇧⌘T the Claude Code one; by key position, as ⌥ changes the letter typed. */
export function placeMenuKey(event: { metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; code: string }): 'shell' | 'claude' | null {
  if (!event.metaKey || !event.altKey || event.ctrlKey || event.code !== 'KeyT') return null;
  return event.shiftKey ? 'claude' : 'shell';
}
