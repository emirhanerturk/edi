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
