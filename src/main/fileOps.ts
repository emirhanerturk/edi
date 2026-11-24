// The Files tab's changes to the working tree: new files and folders, rename, Trash, Finder, and its context menu.
import { lstat } from 'node:fs/promises';
import { createEntry, entryPath, renameEntry } from '../git/entries.js';
import { OUTSIDE } from '../git/files.js';
import type { EntryOpResult, FilesMenuAction, FilesMenuKind } from '../shared/api.js';
import { type Question, renameQuestion, trashQuestion } from './questions.js';
import type { Workspace } from './workspace.js';

export interface FileOpsDeps {
  ask(question: Question): Promise<boolean>;
  trash(target: string): Promise<void>;
  reveal(target: string): void;
  /** Shows the native menu; `-` labels are separators. Resolves with the chosen item's id, or null. */
  menu(items: MenuItem[]): Promise<FilesMenuAction | null>;
}

export interface MenuItem {
  id: FilesMenuAction | null;
  label: string;
}

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const INVALID = { ok: false, error: 'Invalid request' } as const;
const CANCELLED = { ok: false, error: '', cancelled: true } as const;
const SEPARATOR: MenuItem = { id: null, label: '-' };
const KINDS: readonly FilesMenuKind[] = ['repo', 'dir', 'file'];

const nameOf = (relPath: string) => relPath.slice(relPath.lastIndexOf('/') + 1);
const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0);

/** The right-click menu of a row in the Files tab. */
export function menuItems(kind: FilesMenuKind): MenuItem[] {
  const items: MenuItem[] = [];
  if (kind !== 'file') items.push({ id: 'newFile', label: 'New File…' }, { id: 'newFolder', label: 'New Folder…' }, SEPARATOR);
  if (kind !== 'repo') items.push({ id: 'rename', label: 'Rename…' }, { id: 'trash', label: 'Move to Trash' }, SEPARATOR);
  items.push({ id: 'reveal', label: 'Reveal in Finder' });
  return items;
}

/**
 * The repo path is checked against the discovered repos and each file path against the repo's folder
 * (see `entries.ts`). After every change the repo's status is read again.
 */
export class FileOps {
  constructor(
    private readonly ws: Workspace,
    private readonly deps: FileOpsDeps,
  ) {}

  private repo(repoPath: unknown) {
    return typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
  }

  async create(repoPath: unknown, relPath: unknown, kind: unknown): Promise<EntryOpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (kind !== 'file' && kind !== 'dir') return INVALID;
    const result = await createEntry(repo.path, relPath, kind);
    if (result.ok) await this.ws.refresh(repo.path);
    return result;
  }

  /** `unsaved`: open tabs under the path with unsaved edits; they reload from disk, so it asks first. */
  async rename(repoPath: unknown, relPath: unknown, newName: unknown, unsaved: unknown): Promise<EntryOpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof relPath !== 'string') return INVALID;
    const entry = await entryPath(repo.path, relPath);
    if (!entry.ok) return entry;
    if (count(unsaved) > 0 && !(await this.deps.ask(renameQuestion(nameOf(relPath), count(unsaved))))) return CANCELLED;
    const result = await renameEntry(repo.path, relPath, newName);
    if (result.ok) await this.ws.refresh(repo.path);
    return result;
  }

  /** Moves a file or folder to the Trash, after asking. */
  async trash(repoPath: unknown, relPath: unknown, unsaved: unknown): Promise<EntryOpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof relPath !== 'string') return { ok: false, error: OUTSIDE };
    const entry = await entryPath(repo.path, relPath);
    if (!entry.ok) return entry;
    const isDir = await lstat(entry.target).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!(await this.deps.ask(trashQuestion(nameOf(relPath), isDir, count(unsaved))))) return CANCELLED;
    try {
      await this.deps.trash(entry.target);
    } catch {
      return { ok: false, error: 'Could not move it to the Trash' };
    }
    await this.ws.refresh(repo.path);
    return { ok: true, path: relPath };
  }

  /** Shows the file or folder in Finder; '' is the repo itself. */
  async reveal(repoPath: unknown, relPath: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (relPath === '') {
      this.deps.reveal(repo.path);
      return { ok: true };
    }
    const entry = await entryPath(repo.path, relPath);
    if (!entry.ok) return entry;
    this.deps.reveal(entry.target);
    return { ok: true };
  }

  async menu(kind: unknown): Promise<FilesMenuAction | null> {
    if (!KINDS.includes(kind as FilesMenuKind)) return null;
    return this.deps.menu(menuItems(kind as FilesMenuKind));
  }
}
