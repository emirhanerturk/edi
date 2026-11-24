import { describe, expect, it, vi } from 'vitest';
import type { FileContent, WriteResult } from '../../src/shared/api';
import { type EditDoc, EditSession } from '../../src/renderer/center/editSession';

/** A stand-in for a Monaco model: text plus a version that returns to an old value on undo. */
class FakeDoc implements EditDoc {
  private history: string[];
  private index = 0;
  private listeners = new Set<() => void>();
  replaced: string[] = [];
  constructor(text: string) {
    this.history = [text];
  }
  getValue() {
    return this.history[this.index]!;
  }
  version() {
    return this.index;
  }
  replace(text: string) {
    this.replaced.push(text);
    this.type(text);
  }
  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** The user types: a new undo step. */
  type(text: string) {
    this.history = [...this.history.slice(0, this.index + 1), text];
    this.index += 1;
    this.listeners.forEach((listener) => listener());
  }
  undo() {
    this.index -= 1;
    this.listeners.forEach((listener) => listener());
  }
}

const text = (value: string): FileContent => ({ ok: true, kind: 'text', text: value, size: value.length });
const NOT_FOUND: FileContent = { ok: false, error: 'File not found' };

function setup(initial = 'one\n') {
  const doc = new FakeDoc(initial);
  const session = new EditSession(doc, initial);
  const changed = vi.fn();
  session.subscribe(changed);
  return { doc, session, changed };
}

describe('EditSession', () => {
  it('is dirty after typing and clean again after undoing back to the loaded text', () => {
    const { doc, session, changed } = setup();
    expect(session.state.dirty).toBe(false);
    doc.type('one!\n');
    expect(session.state.dirty).toBe(true);
    expect(changed).toHaveBeenCalled();
    doc.undo();
    expect(session.state.dirty).toBe(false);
  });

  it('quietly takes the disk version when there are no unsaved changes, as one undo step', () => {
    const { doc, session } = setup();
    session.disk(text('one\n'));
    expect(doc.replaced).toEqual([]);
    session.disk(text('two\n'));
    expect(doc.replaced).toEqual(['two\n']);
    expect(doc.getValue()).toBe('two\n');
    expect(session.state).toMatchObject({ dirty: false, conflict: null });
  });

  it('with unsaved changes, a changed disk raises a conflict and leaves my text alone', () => {
    const { doc, session } = setup();
    doc.type('mine\n');
    session.disk(text('agent\n'));
    expect(doc.getValue()).toBe('mine\n');
    expect(session.state).toMatchObject({ dirty: true, conflict: 'changed' });
    // The same disk text again doesn't change anything.
    session.disk(text('agent\n'));
    expect(session.state.conflict).toBe('changed');
  });

  it('"Load disk version" drops my changes; "Keep mine" hides the bar until the disk changes again', () => {
    const { doc, session } = setup();
    doc.type('mine\n');
    session.disk(text('agent\n'));
    session.keepMine();
    expect(session.state).toMatchObject({ dirty: true, conflict: null });
    session.disk(text('agent\n'));
    expect(session.state.conflict).toBeNull();
    session.disk(text('agent again\n'));
    expect(session.state.conflict).toBe('changed');
    session.loadDisk();
    expect(doc.getValue()).toBe('agent again\n');
    expect(session.state).toMatchObject({ dirty: false, conflict: null });
  });

  it('a file deleted on disk is a conflict only with unsaved changes; "Keep mine" hides it until it returns', () => {
    const { doc, session } = setup();
    session.disk(NOT_FOUND);
    expect(session.state.conflict).toBeNull();
    doc.type('mine\n');
    session.disk(NOT_FOUND);
    expect(session.state.conflict).toBe('missing');
    session.keepMine();
    session.disk(NOT_FOUND);
    expect(session.state.conflict).toBeNull();
    // It comes back with other text: that's a change again.
    session.disk(text('back\n'));
    expect(session.state.conflict).toBe('changed');
  });

  it('saves against the text the edit started from, then is clean', async () => {
    const { doc, session } = setup();
    doc.type('two\n');
    const write = vi.fn(async (): Promise<WriteResult> => ({ ok: true }));
    await session.save(write);
    expect(write).toHaveBeenCalledWith('two\n', 'one\n');
    expect(session.state).toMatchObject({ dirty: false, conflict: null, error: null, saving: false });
    // The next poll returns what was saved: nothing happens.
    session.disk(text('two\n'));
    expect(doc.replaced).toEqual([]);
    // Typing after the save makes it dirty against the saved text.
    doc.type('three\n');
    expect(session.state.dirty).toBe(true);
  });

  it('after "Keep mine", saving overwrites the disk version I chose to ignore', async () => {
    const { doc, session } = setup();
    doc.type('mine\n');
    session.disk(text('agent\n'));
    session.keepMine();
    const write = vi.fn(async (): Promise<WriteResult> => ({ ok: true }));
    await session.save(write);
    expect(write).toHaveBeenCalledWith('mine\n', 'agent\n');
  });

  it('a save that finds the disk changed shows the conflict; other failures show the error and stay dirty', async () => {
    const { doc, session } = setup();
    doc.type('mine\n');
    await session.save(async () => ({ ok: false, error: 'The file changed on disk', conflict: 'changed' }));
    expect(session.state).toMatchObject({ dirty: true, conflict: 'changed', error: null });
    await session.save(async () => ({ ok: false, error: 'The file no longer exists', conflict: 'missing' }));
    expect(session.state).toMatchObject({ dirty: true, conflict: 'missing' });
    session.keepMine();
    await session.save(async () => ({ ok: false, error: 'Could not save the file' }));
    expect(session.state).toMatchObject({ dirty: true, conflict: null, error: 'Could not save the file' });
    // A bridge failure is an error too, never an unhandled rejection.
    await session.save(async () => {
      throw new Error('bridge lost');
    });
    expect(session.state.error).toBe('Could not save the file');
    // Typing clears the error.
    doc.type('mine 2\n');
    expect(session.state.error).toBeNull();
  });

  it('typed while saving: stays dirty against the saved text', async () => {
    const { doc, session } = setup();
    doc.type('two\n');
    let finish: (result: WriteResult) => void = () => undefined;
    const pending = session.save(() => new Promise((resolve) => (finish = resolve)));
    expect(session.state.saving).toBe(true);
    doc.type('three\n');
    finish({ ok: true });
    await pending;
    expect(session.state).toMatchObject({ dirty: true, saving: false });
    const write = vi.fn(async (): Promise<WriteResult> => ({ ok: true }));
    await session.save(write);
    expect(write).toHaveBeenCalledWith('three\n', 'two\n');
  });

  it('a clean session does not save', async () => {
    const { session } = setup();
    const write = vi.fn(async (): Promise<WriteResult> => ({ ok: true }));
    await session.save(write);
    expect(write).not.toHaveBeenCalled();
  });

  it('the state object stays the same until something changes', () => {
    const { doc, session } = setup();
    const before = session.state;
    session.disk(text('one\n'));
    expect(session.state).toBe(before);
    doc.type('x');
    expect(session.state).not.toBe(before);
  });
});
