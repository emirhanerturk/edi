import type { FileContent, WriteResult } from '../../shared/api';

/** The editor text the session works on: a Monaco model in the app, a stand-in in tests. */
export interface EditDoc {
  getValue(): string;
  /** A number that changes with every edit and comes back to an earlier value on undo. */
  version(): number;
  /** Replaces the whole text as one undo step. */
  replace(text: string): void;
  onChange(listener: () => void): () => void;
}

export interface EditState {
  /** The text differs from what was loaded from or last saved to disk. */
  dirty: boolean;
  /** Unsaved changes and the disk changed under them, or the file was deleted. */
  conflict: 'changed' | 'missing' | null;
  /** The last save failed for another reason. */
  error: string | null;
  saving: boolean;
}

const MISSING = Symbol('missing');
type Disk = string | typeof MISSING;

/**
 * One open file's editing state. `base` is the disk text the edit is based on: saving sends it, and
 * the main process writes only if the disk still matches. Agents change files under the editor, so a
 * new disk version is taken quietly when there are no unsaved changes, and raises a conflict when
 * there are.
 */
export class EditSession {
  state: EditState = { dirty: false, conflict: null, error: null, saving: false };
  private base: string;
  private savedVersion: number;
  /** The last disk version seen by `disk()`. */
  private lastDisk: Disk | null = null;
  /** The disk version the user chose to ignore with "Keep mine". */
  private ignored: Disk | null = null;
  private replacing = false;
  private readonly listeners = new Set<() => void>();
  private readonly stop: () => void;

  constructor(
    private readonly doc: EditDoc,
    loaded: string,
  ) {
    this.base = loaded;
    this.savedVersion = doc.version();
    this.stop = doc.onChange(() => {
      if (this.replacing) return;
      this.update({ error: null });
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  /** The latest read of the file from disk (every status poll). */
  disk(content: FileContent): void {
    if (content.ok && content.kind === 'text') {
      const text = content.text;
      this.lastDisk = text;
      if (text === this.base) return this.update({ conflict: null });
      if (!this.isDirty()) return this.take(text);
      if (this.ignored === text) return;
      return this.update({ conflict: 'changed' });
    }
    if (!content.ok && content.error === 'File not found') {
      this.lastDisk = MISSING;
      if (!this.isDirty() || this.ignored === MISSING) return this.update({ conflict: null });
      return this.update({ conflict: 'missing' });
    }
  }

  /** "Keep mine": hides the bar; the next save overwrites the disk version seen now. */
  keepMine(): void {
    if (typeof this.lastDisk === 'string') this.base = this.lastDisk;
    this.ignored = this.lastDisk;
    this.update({ conflict: null });
  }

  /** "Load disk version": drops the unsaved changes. */
  loadDisk(): void {
    if (typeof this.lastDisk === 'string') this.take(this.lastDisk);
  }

  async save(write: (text: string, expected: string) => Promise<WriteResult>): Promise<void> {
    if (!this.isDirty() || this.state.saving) return;
    const text = this.doc.getValue();
    const version = this.doc.version();
    this.update({ saving: true, error: null });
    let result: WriteResult;
    try {
      result = await write(text, this.base);
    } catch {
      result = { ok: false, error: 'Could not save the file' };
    }
    if (result.ok) {
      this.base = text;
      this.savedVersion = version;
      this.ignored = null;
      this.update({ saving: false, conflict: null, error: null });
    } else if (result.conflict) {
      this.update({ saving: false, conflict: result.conflict });
    } else {
      this.update({ saving: false, error: result.error });
    }
  }

  private isDirty(): boolean {
    return this.doc.version() !== this.savedVersion;
  }

  /** Takes a disk version into the editor: one undo step, clean afterwards. */
  private take(text: string): void {
    this.base = text;
    this.ignored = null;
    if (this.doc.getValue() !== text) {
      this.replacing = true;
      try {
        this.doc.replace(text);
      } finally {
        this.replacing = false;
      }
    }
    this.savedVersion = this.doc.version();
    this.update({ conflict: null, error: null });
  }

  private update(change: Partial<Omit<EditState, 'dirty'>>): void {
    const next = { ...this.state, ...change, dirty: this.isDirty() };
    const same = (Object.keys(next) as (keyof EditState)[]).every((key) => next[key] === this.state[key]);
    if (same) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
