// The native questions asked before something would throw away work.

const QUESTIONS = {
  quit: { message: 'Quit edi?', suffix: '', confirm: 'Quit' },
  switch: { message: 'Switch folders?', suffix: 'Switching closes every terminal.', confirm: 'Switch' },
} as const;

export type BusyKind = keyof typeof QUESTIONS;

export interface Question {
  type: 'warning';
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Before quitting or switching folders: null if no terminal is busy and no file has unsaved changes. */
export function busyQuestion(kind: BusyKind, busyTerminals: number, unsavedFiles: number): Question | null {
  if (busyTerminals === 0 && unsavedFiles === 0) return null;
  const { message, suffix, confirm } = QUESTIONS[kind];
  const lines: string[] = [];
  if (busyTerminals > 0) lines.push(`${plural(busyTerminals, 'terminal still has', 'terminals still have')} a running process.`);
  if (unsavedFiles > 0) lines.push(`${plural(unsavedFiles, 'file has', 'files have')} unsaved changes. They will be lost.`);
  if (busyTerminals > 0 && suffix !== '') lines.push(suffix);
  return { type: 'warning', message, detail: lines.join(' '), buttons: [confirm, 'Cancel'], defaultId: 0, cancelId: 1 };
}

/** Before closing a tab with unsaved changes. */
export function discardQuestion(name: string): Question {
  return {
    type: 'warning',
    message: `Discard changes to ${name}?`,
    detail: 'Your unsaved changes will be lost.',
    buttons: ['Discard changes', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
}

/** Before undoing the newest unpushed commit. */
export function undoCommitQuestion(subject: string): Question {
  const short = subject.length > 60 ? `${subject.slice(0, 59)}…` : subject;
  return {
    type: 'warning',
    message: `Undo the commit "${short}"?`,
    detail: 'The commit is removed from the branch. Its changes stay, staged, so you can commit them again.',
    buttons: ['Undo commit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
}

/** Before dropping a stash: the only stash action that deletes anything. */
export function dropStashQuestion(label: string): Question {
  const short = label.length > 60 ? `${label.slice(0, 59)}…` : label;
  return {
    type: 'warning',
    message: `Drop the stash "${short}"?`,
    detail: 'The stashed changes are deleted. This cannot be undone.',
    buttons: ['Drop stash', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
}

const unsavedLine = (count: number) => `${plural(count, 'open file has', 'open files have')} unsaved changes. They will be lost.`;

/** Before moving a file or folder from the Files tab to the Trash. */
export function trashQuestion(name: string, isDir: boolean, unsavedFiles: number): Question {
  const lines = [isDir ? 'The folder and everything in it go to the Trash. You can restore them from there.' : 'You can restore it from the Trash.'];
  if (unsavedFiles > 0) lines.push(unsavedLine(unsavedFiles));
  return { type: 'warning', message: `Move "${name}" to the Trash?`, detail: lines.join(' '), buttons: ['Move to Trash', 'Cancel'], defaultId: 0, cancelId: 1 };
}

/** Before renaming a file or folder whose open tabs have unsaved edits (the tabs reload from disk). */
export function renameQuestion(name: string, unsavedFiles: number): Question {
  return { type: 'warning', message: `Rename "${name}"?`, detail: unsavedLine(unsavedFiles), buttons: ['Rename', 'Cancel'], defaultId: 0, cancelId: 1 };
}
