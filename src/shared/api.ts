/**
 * The contract between the main process and the page. It holds only types: the page can't reach Node
 * and takes no runtime code from this file.
 */
import type { EditorId } from './editors.js';
import type { ParsedDiff } from '../git/diffParse.js';
import type { BlameCommit, BlameResult, BranchInfo, BranchList, HeadText, IncomingResult, RepoOperation, UnpushedResult } from '../git/types.js';
import type { CommitDetail, CommitFile, CommitResult, CommitSummary, DirList, FileChange, FileContent, FileList, LogResult, RepoStatus, WriteResult } from '../git/types.js';
import type { StashDetail, StashEntry, StashList, StashResult } from '../git/types.js';

export type { BlameCommit, BlameResult, BranchInfo, BranchList, HeadText, IncomingResult, RepoOperation, UnpushedResult };
export type { CommitDetail, CommitFile, CommitResult, CommitSummary, DirList, FileContent, FileList, LogResult, WriteResult };
export type { StashDetail, StashEntry, StashList, StashResult };

export interface RepoView {
  name: string;
  path: string;
  /** Null if the status couldn't be read; the reason is in `error`. */
  status: RepoStatus | null;
  error: string | null;
  /** Label of the operation in progress ("Pushing…"); null if none. */
  busy: string | null;
  /** Number of Claude Code sessions open in a terminal in this repo. */
  claude: number;
  /** The repo has at least one remote; without one there is nowhere to push, pull or publish to. */
  hasRemote: boolean;
  /** When its tags or remote branches last changed (see `refsStamp`); absent until first read. */
  refs?: number;
  /** The merge, rebase, cherry-pick or revert it is in the middle of; null or absent if none. */
  operation?: RepoOperation | null;
}

export interface WorkspaceView {
  /** The open folder; null if none. */
  dir: string | null;
  repos: RepoView[];
  /** Claude Code sessions inside the folder but in no repo. */
  rootSessions: number;
  /** When the statuses were last read (epoch ms). */
  refreshedAt: number;
}

export interface RecentFolder {
  dir: string;
  repoCount: number;
}

export interface Layout {
  /** The terminal panel's width (whichever side it is on). */
  left: number;
  /** The Git / History / Files panel's width (whichever side it is on). */
  right: number;
  diffMode: 'split' | 'inline';
  historyLayout: 'timeline' | 'byRepo';
  /** The side the terminal panel is on; the Git / History / Files panel takes the other (View > Layout). */
  terminals: 'left' | 'right';
}

export interface AppState {
  home: string;
  workspace: WorkspaceView;
  recent: RecentFolder[];
  layout: Layout;
}

/** Operations the page can request on a repo. There are no free-form commands. */
export type GitOp =
  | { op: 'stage'; file: FileChange }
  | { op: 'unstage'; file: FileChange }
  | { op: 'stageAll' }
  | { op: 'unstageAll' }
  | { op: 'commit'; message: string; all: boolean; push: boolean }
  | { op: 'push' }
  | { op: 'pull' }
  | { op: 'fetch' }
  | { op: 'switch'; branch: string }
  | { op: 'createBranch'; branch: string }
  /** `git reset --soft HEAD~1`, only if HEAD is still `oid` and isn't pushed. */
  | { op: 'undoCommit'; oid: string }
  /**
   * Every change, new files included, or only the staged ones; `message` may be empty. `then`: a switch
   * or pull that git refused because of the local changes, run again once they are stashed.
   */
  | { op: 'stash'; message: string; staged: boolean; then?: StashRetry }
  /** A stash is named by its commit id; the main process finds its current position. */
  | { op: 'stashPop'; oid: string }
  | { op: 'stashApply'; oid: string }
  | { op: 'stashDrop'; oid: string }
  | { op: 'stashRename'; oid: string; message: string };

/** What "Stash and switch" or "Stash and pull" runs again. */
export type StashRetry = { op: 'switch'; branch: string } | { op: 'pull' };

/** The right-click menu of a stash row. */
export type StashMenuAction = 'pop' | 'apply' | 'drop';

export type OpResult = { ok: true; message: string } | { ok: false; error: string };

/** A file's change against HEAD and its status entry. */
export type DiffView = { ok: true; diff: ParsedDiff; file: FileChange } | { ok: false; error: string };

/** A file or folder change from the Files tab. `path`: where it is now. `cancelled`: the user said no at the question. */
export type EntryOpResult = { ok: true; path: string } | { ok: false; error: string; cancelled?: true };
/** Saving an untitled editor: where the new file is. `cancelled`: the Save panel was closed. */
export type SaveNewResult = { ok: true; repoPath: string; path: string } | { ok: false; error: string; cancelled?: true };
/** The kind of Files tab row that was right-clicked, and what was picked from its menu. */
export type FilesMenuKind = 'repo' | 'dir' | 'file';
export type FilesMenuAction = 'newFile' | 'newFolder' | 'rename' | 'trash' | 'reveal';

/** `cancelled`: the user backed out at the running-terminals prompt; this is not an error. */
export type OpenResult = { ok: true } | { ok: false; error: string; cancelled?: true };

export interface NewTerminal {
  cols: number;
  rows: number;
  /** If given, the terminal opens in this repo; otherwise in the open folder. Must be a discovered repo path. */
  repoPath?: string;
  /** Starts Claude Code in the terminal. */
  claude?: boolean;
}

export interface TerminalCreated {
  id: number;
  /** The tab's initial title (the shell's name). */
  title: string;
}

/** A tab's state, based on the foreground process in its terminal. */
export interface TabState {
  id: number;
  title: string;
  claude: boolean;
  /** A process other than the shell is running. */
  busy: boolean;
}

/** A localhost port opened for listening in an edi terminal. */
export interface ServerInfo {
  tabId: number;
  port: number;
  pid: number;
  /** The listening process's working directory; null if it couldn't be read. */
  cwd: string | null;
}

/** A usage window: the percentage used (can exceed 100) and the reset time (ms). */
export interface UsageWindow {
  percent: number;
  resetsAt: number;
}

/** Claude usage limits, from Claude Code's status line bridge. */
export interface ClaudeUsage {
  fiveHour: UsageWindow | null;
  week: UsageWindow | null;
  /** When the data was written (ms). */
  updatedAt: number;
}

/** Events the main process sends to the page on its own. */
export interface EdiEvents {
  workspace: [view: WorkspaceView];
  recent: [recent: RecentFolder[]];
  'pty:data': [id: number, data: string];
  'pty:exit': [id: number];
  tabs: [tabs: TabState[]];
  servers: [servers: ServerInfo[]];
  /** Claude usage limits changed (or no valid window is left: null). */
  usage: [usage: ClaudeUsage | null];
  /** The layout changed from the menu (View > Layout). */
  layout: [layout: Layout];
}

/** The bridge given to the page as `window.edi`. */
export interface EdiApi {
  getState(): Promise<AppState>;
  /** Opens the system folder picker; if a folder is chosen, it is opened. */
  chooseFolder(): Promise<void>;
  openFolder(dir: string): Promise<OpenResult>;
  rescan(): Promise<void>;
  /** Saves layout preferences such as panel width; the main process validates them. */
  setLayout(patch: Partial<Layout>): void;
  /** `repoPath` must be the path of a discovered repo; the main process validates it. */
  git(repoPath: string, op: GitOp): Promise<OpResult>;
  /** Fetches in every repo that has a remote; returns the result per repo. */
  fetchAll(): Promise<{ repoPath: string; result: OpResult }[]>;
  branches(repoPath: string): Promise<BranchList>;
  /** The branch's commits its upstream doesn't have (none without an upstream). */
  unpushed(repoPath: string): Promise<UnpushedResult>;
  /** The upstream's commits the branch doesn't have yet, as of the last fetch (none without an upstream). */
  incoming(repoPath: string): Promise<IncomingResult>;
  /** Asks (native dialog) before undoing the commit with this subject; true to go ahead. */
  confirmUndo(subject: string): Promise<boolean>;
  /** The repo's stashes, newest first (at most 100). */
  stashes(repoPath: string): Promise<StashList>;
  /** One stash and its changes, for the stash view; `oid` is the stash commit's full id. */
  stash(repoPath: string, oid: string): Promise<StashResult>;
  /** The native right-click menu of a stash row; Pop and Apply are greyed out unless `canApply`. */
  stashMenu(canApply: boolean): Promise<StashMenuAction | null>;
  /** Asks (native dialog) before dropping the stash with this label; true to go ahead. */
  confirmDropStash(label: string): Promise<boolean>;
  /** A changed file's diff against HEAD (staged and unstaged together). */
  diff(repoPath: string, filePath: string): Promise<DiffView>;
  /** `filePath` is relative to the repo and must stay inside it; the main process validates it. */
  readFile(repoPath: string, filePath: string): Promise<FileContent>;
  /** Saves editor text over an existing file; `expected` is the disk text the edit started from (`null`: overwrite). */
  writeFile(repoPath: string, filePath: string, text: string, expected: string | null): Promise<WriteResult>;
  /** Files tab: an empty file or a folder at `path` (relative to the repo); never overwrites. */
  createEntry(repoPath: string, path: string, kind: 'file' | 'dir'): Promise<EntryOpResult>;
  /** Renames in place. `unsaved`: open tabs under it with unsaved edits (it asks first then). */
  renameEntry(repoPath: string, path: string, name: string, unsaved: number): Promise<EntryOpResult>;
  /** Moves to the Trash after asking. */
  trashEntry(repoPath: string, path: string, unsaved: number): Promise<EntryOpResult>;
  /** Shows it in Finder; '' is the repo itself. */
  revealEntry(repoPath: string, path: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Saves an untitled editor's text as a new file through the Save panel, starting in `repoPath` if given. */
  saveNew(text: string, repoPath: string | null): Promise<SaveNewResult>;
  /** The native right-click menu of a Files tab row; the picked action, or null. */
  filesMenu(kind: FilesMenuKind): Promise<FilesMenuAction | null>;
  /** The file's text at HEAD (null if not in HEAD), to mark the editor's changed lines. */
  headText(repoPath: string, filePath: string): Promise<HeadText>;
  /** Who last changed each line of `text` (the editor's current text for the file). */
  blame(repoPath: string, filePath: string, text: string): Promise<BlameResult>;
  /** Tells the main process how many open files have unsaved edits (asked about on quit and folder switch). */
  setUnsaved(count: number): void;
  /** Asks before closing a tab with unsaved edits; true to discard them. */
  confirmDiscard(name: string): Promise<boolean>;
  /** Files in the working tree; those caught by `.gitignore` are in a separate list (without folder contents). */
  listFiles(repoPath: string): Promise<FileList>;
  /** One level of a folder inside the repo; used to show the contents of an ignored folder. */
  listDir(repoPath: string, dirPath: string): Promise<DirList>;
  /** The last known Claude usage limits; null if the bridge isn't set up or the data has expired. */
  claudeUsage(): Promise<ClaudeUsage | null>;
  /** Opens the file in an editor, or the repo folder if `filePath` is null. */
  openIn(editor: EditorId, repoPath: string, filePath: string | null): Promise<OpResult>;
  /** Opens a web link from the terminal in the default browser (http/https only). */
  openUrl(url: string): Promise<OpResult>;
  log(repoPath: string, count: number): Promise<LogResult>;
  commit(repoPath: string, oid: string): Promise<CommitResult>;
  pty: {
    create(o: NewTerminal): Promise<TerminalCreated>;
    write(id: number, data: string): void;
    resize(id: number, cols: number, rows: number): void;
    /** Closes the terminal and whatever is running in it. */
    close(id: number): void;
  };
  /** The returned function removes the subscription. */
  on<K extends keyof EdiEvents>(channel: K, listener: (...args: EdiEvents[K]) => void): () => void;
}
