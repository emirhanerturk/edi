import { describe, expect, it } from 'vitest';
import { busyQuestion, discardQuestion } from '../src/main/questions.js';

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
