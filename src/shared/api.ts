/**
 * The contract between the main process and the page. It holds only types: the page can't reach Node
 * and takes no runtime code from this file.
 */
import type { EditorId } from './editors.js';
import type { LogoColor } from './projects.js';
import type { ParsedDiff } from '../git/diffParse.js';
import type { BlameCommit, BlameResult, BranchInfo, BranchList, HeadText, IncomingResult, RepoOperation, UnpushedResult } from '../git/types.js';
import type {
  CommitDetail,
  CommitFile,
  CommitResult,
  CommitSummary,
  DirList,
  FileChange,
  FileContent,
  FileList,
  LogResult,
  ReplaceResult,
  RepoStatus,
  TextFile,
  TextLine,
  TextQuery,
  TextSearchResult,
  WriteResult,
} from '../git/types.js';
import type { StashDetail, StashEntry, StashList, StashResult } from '../git/types.js';
import type { FileChangeResult, FileHistoryEntry, FileHistoryResult } from '../git/types.js';

export type { BlameCommit, BlameResult, BranchInfo, BranchList, HeadText, IncomingResult, RepoOperation, UnpushedResult };
export type { CommitDetail, CommitFile, CommitResult, CommitSummary, DirList, FileChange, FileContent, FileList, LogResult, ReplaceResult, TextFile, TextLine, TextQuery, TextSearchResult, WriteResult };

/** What Replace All is about to do, for its question. */
export interface ReplaceAllSummary {
  count: number;
  pattern: string;
  replacement: string;
  files: number;
  repos: number;
}
export type { StashDetail, StashEntry, StashList, StashResult };
export type { FileChangeResult, FileHistoryEntry, FileHistoryResult };

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
  /** Repos found in the folder but ignored by the project (left out of `repos`). */
  ignored: number;
  /** Claude Code sessions inside the folder but in no repo. */
  rootSessions: number;
  /** When the statuses were last read (epoch ms). */
  refreshedAt: number;
}

export interface ProjectLink {
  url: string;
  /** "Admin", "App Store"; empty: the address stands in for it. */
  label: string;
}

/**
 * Which of the repos one level below a project's folder show, and in what order, by folder name:
 * `order` first, in that order, then any others alphabetically; `ignored` ones are left out of edi.
 */
export interface RepoSettings {
  order: string[];
  ignored: string[];
}

/** An image is a copy edi keeps in its own folder; a letter is the name's first letter on a color. */
export type ProjectLogo = { kind: 'image'; file: string } | { kind: 'letter'; color: LogoColor };

/** A folder of git repositories with a name, a logo and links. */
export interface Project {
  id: string;
  /** The folder (its real path); its git repositories are what the project shows. */
  dir: string;
  name: string;
  logo: ProjectLogo;
  /** The first one is the main link, written out in the title bar. */
  links: ProjectLink[];
  /** When it was last opened (epoch ms); 0 if unknown (a folder opened before projects existed). */
  openedAt: number;
  /** The git repositories shown when it was last opened (the ignored ones aren't counted). */
  repoCount: number;
  repos: RepoSettings;
}

/** A project as the page shows it. */
export interface ProjectView extends Project {
  /** The image logo's address; null with a letter. */
  logoUrl: string | null;
  /** The folder is still where it was. */
  exists: boolean;
  /** It is the project open in the window. */
  open: boolean;
}

/** An image that can become a project's logo: found in its folder or picked with Choose…. */
export interface LogoCandidate {
  /** Given by the main process; the page sends it back to pick the image. */
  id: string;
  /** Relative to the folder (`docs/design/icon/wordmark.svg`), or the file's name for one picked with Choose…. */
  path: string;
  /** The address that shows it. */
  url: string;
}

/** What the New project (and Edit project) sheet starts with for a folder. */
export interface ProjectDraft {
  dir: string;
  /** The folder's name: the suggested project name. */
  name: string;
  repoCount: number;
  /** Every repo found one level down, alphabetically; empty when the folder itself is a repo (nothing to order). */
  repoNames: string[];
  /** Images in the folder that look like its logo, the likeliest first. */
  logos: LogoCandidate[];
  /** The repository's web page, for a folder holding a single repository with a remote on a known host. */
  links: ProjectLink[];
  /** The project that already has this folder (other than the one being edited); null if none. */
  taken: { id: string; name: string } | null;
}

/** What the sheet sends. */
export interface ProjectInput {
  dir: string;
  name: string;
  /** `candidate`: one of the images offered (found or chosen); `keep`: the project's current image. */
  logo: { kind: 'candidate'; id: string } | { kind: 'keep' } | { kind: 'letter'; color: LogoColor };
  /** The first one is the main link. */
  links: ProjectLink[];
  repos: RepoSettings;
}

/** The right-click menu of a project card (and of its … button). `link:N`: open the project's Nth link. */
export type ProjectMenuAction = 'open' | 'edit' | 'reveal' | 'remove' | `link:${number}`;

/** Choose… in the sheet: the image picked, why it can't be used, or null if the panel was cancelled. */
export type ChosenLogo = { ok: true; logo: LogoCandidate } | { ok: false; error: string } | null;

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
  /** Last opened first. */
  projects: ProjectView[];
  /** `edi <folder>` named a folder that isn't a project yet: the New project sheet to show. */
  draft: ProjectDraft | null;
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
  /** `git revert --no-edit`; aborted again at once if it stops on conflicts. */
  | { op: 'revertCommit'; oid: string }
  /** The file's unstaged changes are thrown away; a new file goes to the Trash. The index isn't touched. */
  | { op: 'discard'; file: FileChange }
  /** Every unstaged change in the repo, as `discard` does for one file. `files`: the CHANGES the user was asked about. */
  | { op: 'discardAll'; files: FileChange[] }
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

/** A commit's menu (History's right-click, the commit view's ⋯): what was picked. */
/** What a discard question is about: one file, or every change in a repo (with what happens to them). */
export type DiscardTarget = { kind: 'file'; name: string; untracked: boolean } | { kind: 'all'; repo: string; changed: number; untracked: number };

export type CommitMenuAction = 'copy' | 'github' | 'revert';
export type CommitMenuChoice = { action: 'copy' } | { action: 'github'; url: string } | { action: 'revert' };

export type OpResult = { ok: true; message: string } | { ok: false; error: string };

/** A file's change against HEAD and its status entry. */
export type DiffView = { ok: true; diff: ParsedDiff; file: FileChange } | { ok: false; error: string };

/** A file or folder change from the Files tab. `path`: where it is now. `cancelled`: the user said no at the question. */
export type EntryOpResult = { ok: true; path: string } | { ok: false; error: string; cancelled?: true };
/** Saving an untitled editor: where the new file is. `cancelled`: the Save panel was closed. */
export type SaveNewResult = { ok: true; repoPath: string; path: string } | { ok: false; error: string; cancelled?: true };
/** The kind of Files tab row that was right-clicked, and what was picked from its menu. */
export type FilesMenuKind = 'repo' | 'dir' | 'file';
export type FilesMenuAction =
  | 'newFile'
  | 'newFolder'
  | 'rename'
  | 'trash'
  | 'reveal'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'copyPath'
  | 'copyRelativePath'
  | 'newTerminal'
  | 'history'
  | 'find'
  | `openIn:${EditorId}`;

/** A Git tab file row, for its right-click menu: what applies to it. */
export interface GitFileMenuState {
  group: 'staged' | 'changes' | 'conflicts';
  /** Deleted in the working tree: there is no file to open or show in Finder. */
  deleted: boolean;
  /** Not tracked yet: a click opens its content, and it has no history. */
  untracked: boolean;
  /** Whether Discard Changes can run now. */
  canDiscard: boolean;
}

export type GitFileMenuAction =
  | 'openChanges'
  | 'openFile'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'copyPath'
  | 'copyRelativePath'
  | 'history'
  | 'reveal'
  | `openIn:${EditorId}`;

/** `cancelled`: the user backed out at the running-terminals prompt; this is not an error. */
export type OpenResult = { ok: true } | { ok: false; error: string; cancelled?: true };

export interface NewTerminal {
  cols: number;
  rows: number;
  /** If given, the terminal opens in this repo; otherwise in the open folder. Must be a discovered repo path. */
  repoPath?: string;
  /** A folder inside `repoPath` (relative to it) to open in instead of the repo's own folder. */
  dir?: string;
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
  /** Null while no window is running: it hasn't started yet, or its reset time has passed (0% used). */
  fiveHour: UsageWindow | null;
  week: UsageWindow | null;
  /** When the data was written (ms). */
  updatedAt: number;
}

/** Events the main process sends to the page on its own. */
export interface EdiEvents {
  workspace: [view: WorkspaceView];
  /** A project was made, changed, removed or opened. Last opened first. */
  projects: [projects: ProjectView[]];
  /** `edi <folder>` named a folder that isn't a project yet: the page shows the New project sheet for it. */
  'project:draft': [draft: ProjectDraft];
  'pty:data': [id: number, data: string];
  'pty:exit': [id: number];
  tabs: [tabs: TabState[]];
  servers: [servers: ServerInfo[]];
  /** Claude usage limits changed (null: the bridge isn't set up, or its file is broken). */
  usage: [usage: ClaudeUsage | null];
  /** The layout changed from the menu (View > Layout). */
  layout: [layout: Layout];
}

/** The bridge given to the page as `window.edi`. */
export interface EdiApi {
  getState(): Promise<AppState>;
  /**
   * New project (⌘O): the folder panel first. A folder that already is a project opens; for any other,
   * what the New project sheet starts with. Null if the panel was cancelled or a project opened.
   */
  newProject(): Promise<ProjectDraft | null>;
  /** Change… in the sheet: another folder through the panel. `projectId`: the project being edited, if any. */
  chooseProjectFolder(projectId: string | null): Promise<ProjectDraft | null>;
  /** Edit project…: the images and repositories of the project's folder, for the sheet. */
  projectDraft(projectId: string): Promise<ProjectDraft | null>;
  /** Choose… in the sheet: an image through the open panel. */
  chooseLogo(): Promise<ChosenLogo>;
  /** Makes the project and opens it. */
  createProject(input: ProjectInput): Promise<OpenResult>;
  /** Saves the sheet's changes to a project. */
  updateProject(projectId: string, input: ProjectInput): Promise<OpenResult>;
  /** Forgets the project, after asking; its folder stays as it is. The open project closes first. */
  removeProject(projectId: string): Promise<OpenResult>;
  openProject(projectId: string): Promise<OpenResult>;
  /** Locate…: the folder panel, for a project whose folder has moved. */
  locateProject(projectId: string): Promise<OpenResult>;
  revealProject(projectId: string): Promise<void>;
  /** The native right-click menu of a project card; the picked action, or null. */
  projectMenu(projectId: string): Promise<ProjectMenuAction | null>;
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
  /** Asks (native dialog) before reverting the commit with this subject; true to go ahead. */
  confirmRevert(subject: string): Promise<boolean>;
  /** Asks (native dialog) before discarding changes; true to go ahead. */
  confirmDiscardChanges(target: DiscardTarget): Promise<boolean>;
  /**
   * A commit's native menu. `links`: Copy SHA and Open on GitHub too (History); without, only Revert
   * (the commit view's ⋯). `canRevert`: false greys Revert out (merge commits). Null if nothing was picked.
   */
  commitMenu(repoPath: string, oid: string, opts: { links: boolean; canRevert: boolean }): Promise<CommitMenuChoice | null>;
  /** The repo's stashes, newest first (at most 100). */
  stashes(repoPath: string): Promise<StashList>;
  /** One stash and its changes, for the stash view; `oid` is the stash commit's full id. */
  stash(repoPath: string, oid: string): Promise<StashResult>;
  /** The native right-click menu of a changed file's row in the Git tab; the picked action, or null. */
  gitFileMenu(state: GitFileMenuState): Promise<GitFileMenuAction | null>;
  /** The native right-click menu of a stash row; Pop and Apply are greyed out unless `canApply`. */
  stashMenu(canApply: boolean): Promise<StashMenuAction | null>;
  /** Asks (native dialog) before dropping the stash with this label; true to go ahead. */
  confirmDropStash(label: string): Promise<boolean>;
  /** A changed file's diff against HEAD (staged and unstaged together). */
  diff(repoPath: string, filePath: string): Promise<DiffView>;
  /** `filePath` is relative to the repo and must stay inside it; the main process validates it. */
  readFile(repoPath: string, filePath: string): Promise<FileContent>;
  /** An image or video's size in bytes, in the working tree or (`rev`: a commit id, `id^`, `id^N`) as it was in a commit. */
  mediaSize(repoPath: string, filePath: string, rev: string | null): Promise<number | null>;
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
  /** Copy: puts the file or folder on the clipboard (Finder can paste it) and keeps it for `pasteEntry`. */
  copyEntry(repoPath: string, path: string): Promise<EntryOpResult>;
  /** Paste: what was copied, into the folder `dir` ('' is the repo); never replaces, a name in use gets " copy". */
  pasteEntry(repoPath: string, dir: string): Promise<EntryOpResult>;
  /** Duplicate: a copy beside it named "… copy". */
  duplicateEntry(repoPath: string, path: string): Promise<EntryOpResult>;
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
  /** Searches the repo's files (those git lists, not ignored ones). A newer `id` stops an older search. */
  searchText(repoPath: string, query: TextQuery, id: number): Promise<TextSearchResult>;
  /** Stops the searches older than `id`. */
  stopSearch(id: number): void;
  /** Replaces the matches on `lines` of one file, only if it still holds the text that was searched (`stamp`). */
  replaceText(repoPath: string, path: string, query: TextQuery, replacement: string, stamp: string, lines: number[]): Promise<ReplaceResult>;
  /** Asks before Replace All; true to go ahead. */
  confirmReplaceAll(summary: ReplaceAllSummary): Promise<boolean>;
  /** One level of a folder inside the repo; used to show the contents of an ignored folder. */
  listDir(repoPath: string, dirPath: string): Promise<DirList>;
  /** The last known Claude usage limits; null if the bridge isn't set up. */
  claudeUsage(): Promise<ClaudeUsage | null>;
  /** Opens the file in an editor, or the repo folder if `filePath` is null. */
  openIn(editor: EditorId, repoPath: string, filePath: string | null): Promise<OpResult>;
  /** Opens a web link from the terminal in the default browser (http/https only). */
  openUrl(url: string): Promise<OpResult>;
  log(repoPath: string, count: number): Promise<LogResult>;
  /** The commits that changed a file (its path now), newest first, following renames; `count` a multiple of 50. */
  fileHistory(repoPath: string, path: string, count: number): Promise<FileHistoryResult>;
  /** A file's change in one commit of its history; `origPath`: where it was before, if that commit renamed it. */
  fileChange(repoPath: string, oid: string, path: string, origPath: string | null): Promise<FileChangeResult>;
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
