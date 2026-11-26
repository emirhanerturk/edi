import { describe, expect, it } from 'vitest';
import { busyQuestion, discardChangesQuestion, discardQuestion, discardTarget, dropStashQuestion, removeProjectQuestion, renameQuestion, trashQuestion, revertCommitQuestion, undoCommitQuestion } from '../src/main/questions.js';

describe('busyQuestion', () => {
  it('asks nothing when no terminal is busy and no file has unsaved changes', () => {
    expect(busyQuestion('quit', 0, 0)).toBeNull();
    expect(busyQuestion('switch', 0, 0)).toBeNull();
  });

  it('names running terminals, unsaved files, or both', () => {
    expect(busyQuestion('quit', 1, 0)).toMatchObject({ message: 'Quit edi?', detail: '1 terminal still has a running process.', buttons: ['Quit', 'Cancel'] });
    expect(busyQuestion('quit', 0, 1)?.detail).toBe('1 file has unsaved changes. They will be lost.');
    expect(busyQuestion('quit', 2, 3)?.detail).toBe('2 terminals still have a running process. 3 files have unsaved changes. They will be lost.');
    expect(busyQuestion('switch', 2, 0)).toMatchObject({
      message: 'Switch folders?',
      detail: '2 terminals still have a running process. Switching closes every terminal.',
      buttons: ['Switch', 'Cancel'],
    });
    expect(busyQuestion('switch', 0, 1)?.detail).toBe('1 file has unsaved changes. They will be lost.');
  });

  it('Cancel is the escape answer and the confirm button is the default', () => {
    expect(busyQuestion('quit', 1, 1)).toMatchObject({ type: 'warning', defaultId: 0, cancelId: 1 });
  });

  it('asks while a git operation runs, naming the repos', () => {
    expect(busyQuestion('quit', 0, 0, ['app'])).toMatchObject({
      message: 'Quit edi?',
      detail: 'A git operation is still running in app. Quitting may cut it off halfway.',
      buttons: ['Quit', 'Cancel'],
    });
    expect(busyQuestion('quit', 0, 0, ['app', 'web', 'api'])?.detail).toBe(
      'Git operations are still running in app, web and api. Quitting may cut them off halfway.',
    );
    expect(busyQuestion('switch', 0, 0, ['app'])?.detail).toBe('A git operation is still running in app. Its result will not be shown.');
    expect(busyQuestion('switch', 1, 0, ['app', 'web'])?.detail).toBe(
      'Git operations are still running in app and web. Their results will not be shown. 1 terminal still has a running process. Switching closes every terminal.',
    );
  });
});

describe('discardQuestion', () => {
  it('names the file and puts Cancel on Escape', () => {
    expect(discardQuestion('app.ts')).toEqual({
      type: 'warning',
      message: 'Discard changes to app.ts?',
      detail: 'Your unsaved changes will be lost.',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
  });
});

describe('undoCommitQuestion', () => {
  it('names the commit and says the changes come back staged; long subjects are shortened', () => {
    expect(undoCommitQuestion('feat: add a thing')).toEqual({
      type: 'warning',
      message: 'Undo the commit "feat: add a thing"?',
      detail: 'The commit is removed from the branch. Its changes stay, staged, so you can commit them again.',
      buttons: ['Undo commit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    expect(undoCommitQuestion('x'.repeat(100)).message).toBe(`Undo the commit "${'x'.repeat(59)}…"?`);
  });
});

describe('dropStashQuestion', () => {
  it('names the stash and says the changes are deleted; long labels are shortened', () => {
    expect(dropStashQuestion('wip: login form')).toEqual({
      type: 'warning',
      message: 'Drop the stash "wip: login form"?',
      detail: 'The stashed changes are deleted. This cannot be undone.',
      buttons: ['Drop stash', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    expect(dropStashQuestion('x'.repeat(100)).message).toBe(`Drop the stash "${'x'.repeat(59)}…"?`);
  });
});

describe('trashQuestion', () => {
  it('asks to delete it, says it goes to the Trash, warns about uncommitted changes and unsaved edits', () => {
    expect(trashQuestion('a.ts', false, 0)).toEqual({
      type: 'warning',
      message: 'Delete "a.ts"?',
      detail: 'It goes to the Trash, and you can put it back from there.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    expect(trashQuestion('a.ts', false, 0, true).detail).toBe("It goes to the Trash, and you can put it back from there. It has changes that aren't committed.");
    expect(trashQuestion('src', true, 0).detail).toBe('The folder and everything in it go to the Trash, and you can put them back from there.');
    expect(trashQuestion('src', true, 2, true).detail).toBe(
      "The folder and everything in it go to the Trash, and you can put them back from there. Some of its files have changes that aren't committed. 2 open files have unsaved changes. They will be lost.",
    );
  });
});

describe('renameQuestion', () => {
  it('asks only because of unsaved edits', () => {
    expect(renameQuestion('a.ts', 1)).toEqual({
      type: 'warning',
      message: 'Rename "a.ts"?',
      detail: '1 open file has unsaved changes. They will be lost.',
      buttons: ['Rename', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
  });
});

describe('closing and removing a project', () => {
  it('asks before closing the open project while a terminal is busy', () => {
    expect(busyQuestion('close', 0, 0)).toBeNull();
    expect(busyQuestion('close', 1, 0)).toMatchObject({
      message: 'Close the project?',
      detail: '1 terminal still has a running process. Closing it closes every terminal.',
      buttons: ['Close', 'Cancel'],
    });
  });

  it('says the folder stays when a project is removed from the list', () => {
    expect(removeProjectQuestion('Quizei')).toEqual({
      type: 'warning',
      message: 'Remove "Quizei" from the list?',
      detail: 'edi forgets its name, logo and links. The folder and its repositories stay as they are.',
      buttons: ['Remove', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    expect(removeProjectQuestion('x'.repeat(80)).message).toBe(`Remove "${'x'.repeat(59)}…" from the list?`);
  });
});

describe('revertCommitQuestion', () => {
  it('names the commit and says a new commit undoes it; long subjects are shortened', () => {
    expect(revertCommitQuestion('feat: a')).toEqual({
      type: 'warning',
      message: 'Revert the commit "feat: a"?',
      detail: 'A new commit is made that undoes its changes. The original commit stays in the history.',
      buttons: ['Revert commit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    expect(revertCommitQuestion('x'.repeat(100)).message).toBe(`Revert the commit "${'x'.repeat(59)}…"?`);
  });
});

describe('discardChangesQuestion', () => {
  const base = { type: 'warning', buttons: ['Discard', 'Cancel'], defaultId: 0, cancelId: 1 };

  it('a tracked file: its changes are lost for good', () => {
    expect(discardChangesQuestion({ kind: 'file', name: 'app.ts', untracked: false })).toEqual({
      ...base,
      message: 'Discard changes to app.ts?',
      detail: "This can't be undone.",
    });
  });

  it('a new file goes to the Trash', () => {
    expect(discardChangesQuestion({ kind: 'file', name: 'new.ts', untracked: true })).toEqual({
      ...base,
      message: 'Move new.ts to the Trash?',
      detail: 'It is new, so git has no copy of it.',
    });
  });

  it('all: names the repo and counts what happens, leaving out a zero part', () => {
    expect(discardChangesQuestion({ kind: 'all', repo: 'app', changed: 3, untracked: 2 })).toEqual({
      ...base,
      message: 'Discard all changes in app?',
      detail: "3 changed files are reset and 2 new files go to the Trash. Staged changes stay. This can't be undone.",
    });
    expect(discardChangesQuestion({ kind: 'all', repo: 'app', changed: 1, untracked: 0 }).detail).toBe("1 changed file is reset. Staged changes stay. This can't be undone.");
    expect(discardChangesQuestion({ kind: 'all', repo: 'app', changed: 0, untracked: 1 }).detail).toBe("1 new file goes to the Trash. Staged changes stay. This can't be undone.");
  });
});

describe('discardTarget', () => {
  it('keeps a well-formed target and refuses anything else', () => {
    expect(discardTarget({ kind: 'file', name: 'a.ts', untracked: false })).toEqual({ kind: 'file', name: 'a.ts', untracked: false });
    expect(discardTarget({ kind: 'all', repo: 'app', changed: 2, untracked: 0, extra: 1 })).toEqual({ kind: 'all', repo: 'app', changed: 2, untracked: 0 });
    for (const bad of [null, 'all', { kind: 'file', name: 1, untracked: false }, { kind: 'file', name: 'a' }, { kind: 'all', repo: 'app', changed: -1, untracked: 0 }, { kind: 'all', repo: 'app', changed: 1.5, untracked: 0 }, { kind: 'x' }]) {
      expect(discardTarget(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
