// The native questions asked before something would throw away work.
import type { DiscardTarget } from '../shared/api.js';

const QUESTIONS = {
  quit: { message: 'Quit edi?', suffix: '', git: ['Quitting may cut it off halfway.', 'Quitting may cut them off halfway.'], confirm: 'Quit' },
  switch: {
    message: 'Switch folders?',
    suffix: 'Switching closes every terminal.',
    git: ['Its result will not be shown.', 'Their results will not be shown.'],
    confirm: 'Switch',
  },
  close: {
    message: 'Close the project?',
    suffix: 'Closing it closes every terminal.',
    git: ['Its result will not be shown.', 'Their results will not be shown.'],
    confirm: 'Close',
  },
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

/** "a", "a and b", "a, b and c". */
const names = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/**
 * Before quitting or switching folders: null if no terminal is busy, no git operation of the user's is
 * running (`gitRepos`: the names of the repos running one) and no file has unsaved changes.
 */
export function busyQuestion(kind: BusyKind, busyTerminals: number, unsavedFiles: number, gitRepos: string[] = []): Question | null {
  if (busyTerminals === 0 && unsavedFiles === 0 && gitRepos.length === 0) return null;
  const { message, suffix, git, confirm } = QUESTIONS[kind];
  const lines: string[] = [];
  if (gitRepos.length > 0) {
    const one = gitRepos.length === 1;
    lines.push(`${one ? 'A git operation is' : 'Git operations are'} still running in ${names(gitRepos)}. ${git[one ? 0 : 1]}`);
  }
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

/** Before forgetting a project: its settings go, its folder stays. */
export function removeProjectQuestion(name: string): Question {
  const short = name.length > 60 ? `${name.slice(0, 59)}…` : name;
  return {
    type: 'warning',
    message: `Remove "${short}" from the list?`,
    detail: 'edi forgets its name, logo and links. The folder and its repositories stay as they are.',
    buttons: ['Remove', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
}

/** Before reverting a commit: a new commit undoes it. */
export function revertCommitQuestion(subject: string): Question {
  const short = subject.length > 60 ? `${subject.slice(0, 59)}…` : subject;
  return {
    type: 'warning',
    message: `Revert the commit "${short}"?`,
    detail: 'A new commit is made that undoes its changes. The original commit stays in the history.',
    buttons: ['Revert commit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
}

/** Before discarding changes in the Git tab: a tracked file's are lost for good, a new file goes to the Trash. */
export function discardChangesQuestion(target: DiscardTarget): Question {
  const ask = (message: string, detail: string): Question => ({ type: 'warning', message, detail, buttons: ['Discard', 'Cancel'], defaultId: 0, cancelId: 1 });
  if (target.kind === 'file') {
    return target.untracked
      ? ask(`Move ${target.name} to the Trash?`, 'It is new, so git has no copy of it.')
      : ask(`Discard changes to ${target.name}?`, "This can't be undone.");
  }
  const parts = [
    target.changed > 0 ? plural(target.changed, 'changed file is reset', 'changed files are reset') : null,
    target.untracked > 0 ? plural(target.untracked, 'new file goes to the Trash', 'new files go to the Trash') : null,
  ].filter((part) => part !== null);
  return ask(`Discard all changes in ${target.repo}?`, `${parts.join(' and ')}. Staged changes stay. This can't be undone.`);
}

/** A discard question's target as the page sent it; null if it isn't well formed. */
export function discardTarget(value: unknown): DiscardTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const count = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (v.kind === 'file' && typeof v.name === 'string' && typeof v.untracked === 'boolean') return { kind: 'file', name: v.name, untracked: v.untracked };
  if (v.kind === 'all' && typeof v.repo === 'string' && count(v.changed) && count(v.untracked)) {
    return { kind: 'all', repo: v.repo, changed: v.changed as number, untracked: v.untracked as number };
  }
  return null;
}
