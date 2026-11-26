// The Files tab's changes to the working tree: new files and folders, rename, Trash, Finder, and its context menu.
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { copyEntry, createEntry, entryPath, renameEntry } from '../git/entries.js';
import { MAX_WRITE_BYTES, OUTSIDE } from '../git/files.js';
import { EDITORS } from '../shared/editors.js';
import type { EntryOpResult, FilesMenuAction, FilesMenuKind, SaveNewResult } from '../shared/api.js';
import { type Question, renameQuestion, trashQuestion } from './questions.js';
import type { Workspace } from './workspace.js';

export interface FileOpsDeps {
  ask(question: Question): Promise<boolean>;
  trash(target: string): Promise<void>;
  reveal(target: string): void;
  /** Puts the file or folder on the system clipboard, as Finder's Copy does. */
  copyToClipboard(target: string): void;
  /** Shows the native menu; `-` labels are separators. Resolves with the chosen item's id, or null. */
  menu(items: MenuItem[]): Promise<FilesMenuAction | null>;
  /** The Save panel, starting at `defaultPath`; the chosen absolute path, or null if cancelled. */
  choosePath(defaultPath: string): Promise<string | null>;
}

export interface MenuItem {
  id: FilesMenuAction | null;
  label: string;
  enabled?: boolean;
  /** The key shown beside it; the menu doesn't take the key, the Files tab does. */
  accelerator?: string;
  submenu?: MenuItem[];
}

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const INVALID = { ok: false, error: 'Invalid request' } as const;
const CANCELLED = { ok: false, error: '', cancelled: true } as const;
const SEPARATOR: MenuItem = { id: null, label: '-' };
const KINDS: readonly FilesMenuKind[] = ['repo', 'dir', 'file'];

const nameOf = (relPath: string) => relPath.slice(relPath.lastIndexOf('/') + 1);
const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0);

/**
 * The right-click menu of a row in the Files tab. `canPaste`: something was copied in the Files tab.
 * The keys shown are the Files tab's own.
 */
export function menuItems(kind: FilesMenuKind, canPaste = false): MenuItem[] {
  const copyPath: MenuItem = { id: 'copyPath', label: 'Copy Path', accelerator: 'Alt+Command+C' };
  const copyRelative: MenuItem = { id: 'copyRelativePath', label: 'Copy Relative Path', accelerator: 'Shift+Alt+Command+C' };
  const copy: MenuItem = { id: 'copy', label: 'Copy', accelerator: 'Command+C' };
  const paste: MenuItem = { id: 'paste', label: 'Paste', accelerator: 'Command+V', enabled: canPaste };
  const rename: MenuItem = { id: 'rename', label: 'Rename…', accelerator: 'F2' };
  const remove: MenuItem = { id: 'trash', label: 'Delete', accelerator: 'Command+Backspace' };
  const reveal: MenuItem = { id: 'reveal', label: 'Reveal in Finder', accelerator: 'Alt+Command+R' };
  const newItems: MenuItem[] = [{ id: 'newFile', label: 'New File…' }, { id: 'newFolder', label: 'New Folder…' }, SEPARATOR];
  const terminal: MenuItem = { id: 'newTerminal', label: 'New Terminal Here' };
  if (kind === 'file') {
    const openIn: MenuItem = { id: null, label: 'Open in', submenu: EDITORS.map((editor) => ({ id: `openIn:${editor.id}` as const, label: editor.name })) };
    return [
      openIn,
      { id: 'history', label: 'File History' },
      SEPARATOR,
      copy,
      copyPath,
      copyRelative,
      SEPARATOR,
      rename,
      { id: 'duplicate', label: 'Duplicate', accelerator: 'Command+D' },
      remove,
      SEPARATOR,
      reveal,
    ];
  }
  if (kind === 'dir') return [...newItems, terminal, SEPARATOR, copy, paste, copyPath, copyRelative, SEPARATOR, rename, remove, SEPARATOR, reveal];
  return [...newItems, terminal, SEPARATOR, paste, copyPath, SEPARATOR, reveal];
}

/**
 * The repo path is checked against the discovered repos and each file path against the repo's folder
 * (see `entries.ts`). After every change the repo's status is read again.
 */
export class FileOps {
  /** What Copy put aside for Paste: a file or folder in a discovered repo, checked again when pasted. */
  private copied: { repoPath: string; relPath: string } | null = null;

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
    const changed = (repo.status?.files ?? []).some((file) => file.path === relPath || file.path.startsWith(`${relPath}/`));
    if (!(await this.deps.ask(trashQuestion(nameOf(relPath), isDir, count(unsaved), changed)))) return CANCELLED;
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

  /**
   * Saves an untitled editor's text as a new file: the Save panel starts in `suggested` (a repo) or the
   * open folder. The place must be inside one of the folder's repos, and an existing file is never
   * replaced (the panel can't be stopped from offering one).
   */
  async saveNew(text: unknown, suggested: unknown): Promise<SaveNewResult> {
    if (typeof text !== 'string') return { ok: false, error: 'Invalid text' };
    if (Buffer.byteLength(text) > MAX_WRITE_BYTES) return { ok: false, error: 'The text is too large to save' };
    const start = this.repo(suggested)?.path ?? this.ws.view().dir;
    if (start === null) return { ok: false, error: 'No folder is open' };
    const chosen = await this.deps.choosePath(join(start, 'Untitled.txt'));
    if (chosen === null) return CANCELLED;
    const place = await this.repoHolding(dirname(chosen));
    if (!place) return { ok: false, error: 'Save it inside one of the repositories in this folder' };
    const relPath = place.rel === '' ? basename(chosen) : `${place.rel}/${basename(chosen)}`;
    const result = await createEntry(place.repo, relPath, 'file', text);
    if (!result.ok) return result;
    await this.ws.refresh(place.repo);
    return { ok: true, repoPath: place.repo, path: result.path };
  }

  /** The innermost discovered repo holding `dir`, and `dir` relative to it ('/'-separated). */
  private async repoHolding(dir: string): Promise<{ repo: string; rel: string } | null> {
    const real = await realpath(dir).catch(() => null);
    if (real === null) return null;
    let best: { repo: string; rel: string; depth: number } | null = null;
    for (const repo of this.ws.view().repos) {
      const root = await realpath(repo.path).catch(() => null);
      if (root === null) continue;
      const rel = relative(root, real);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      if (!best || root.length > best.depth) best = { repo: repo.path, rel: rel.split(sep).join('/'), depth: root.length };
    }
    return best && { repo: best.repo, rel: best.rel };
  }

  async menu(kind: unknown): Promise<FilesMenuAction | null> {
    if (!KINDS.includes(kind as FilesMenuKind)) return null;
    return this.deps.menu(menuItems(kind as FilesMenuKind, this.copied !== null));
  }

  /** Copy: the file or folder goes on the clipboard (Finder can paste it) and is kept for Paste. */
  async copy(repoPath: unknown, relPath: unknown): Promise<EntryOpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    const entry = await entryPath(repo.path, relPath);
    if (!entry.ok) return entry;
    this.copied = { repoPath: repo.path, relPath: relPath as string };
    this.deps.copyToClipboard(entry.target);
    return { ok: true, path: relPath as string };
  }

  /** Paste: what was copied goes into the folder `relDir` ('' is the repo); a name in use gets " copy". */
  async paste(repoPath: unknown, relDir: unknown): Promise<EntryOpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    const source = this.copied && this.repo(this.copied.repoPath);
    if (!this.copied || !source) return { ok: false, error: 'Copy a file or folder first' };
    const from = await entryPath(source.path, this.copied.relPath);
    if (!from.ok) return from;
    const result = await copyEntry(repo.path, from.target, relDir);
    if (result.ok) await this.ws.refresh(repo.path);
    return result;
  }

  /** Duplicate: a copy beside it, "name copy". */
  async duplicate(repoPath: unknown, relPath: unknown): Promise<EntryOpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    const entry = await entryPath(repo.path, relPath);
    if (!entry.ok) return entry;
    const path = relPath as string;
    const result = await copyEntry(repo.path, entry.target, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    if (result.ok) await this.ws.refresh(repo.path);
    return result;
  }
}
