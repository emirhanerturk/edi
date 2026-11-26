// How a CHANGES entry is discarded, or why it isn't. Pure: the main process acts on it and the Git tab
// shows it (a disabled button with the reason, the counts in the question).
import type { FileChange } from './types.js';

export type DiscardHow =
  /** Tracked: the work tree goes back to the staged (or committed) text. */
  | { how: 'restore' }
  /** New: the file goes to the Trash. */
  | { how: 'trash' }
  /** New, added with `git add -N`: its empty index entry is dropped, then the file goes to the Trash. */
  | { how: 'untrack-and-trash' }
  | { how: 'refuse'; reason: string };

export function discardHow(f: FileChange): DiscardHow {
  if (f.kind === 'conflicted') return { how: 'refuse', reason: 'Resolve the conflicts first' };
  if (f.kind === 'untracked') {
    // git lists a repository nested in this one as its folder, with a trailing slash.
    return f.path.endsWith('/') ? { how: 'refuse', reason: 'A repository inside this one is left alone' } : { how: 'trash' };
  }
  if (f.y === '.') return { how: 'refuse', reason: 'Nothing to discard' };
  if (f.y === 'A') return { how: 'untrack-and-trash' };
  if (f.y === 'R') return { how: 'refuse', reason: 'A rename made with git add -N: discard it in a terminal' };
  return { how: 'restore' };
}

/** Whether discarding the entry makes it go to the Trash (what the question says about it). */
export const goesToTrash = (f: FileChange) => {
  const { how } = discardHow(f);
  return how === 'trash' || how === 'untrack-and-trash';
};
