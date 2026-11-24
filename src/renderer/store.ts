import { create } from 'zustand';
import type { ClaudeUsage, GitOp, Layout, LogResult, RecentFolder, ServerInfo, TabState, WorkspaceView } from '../shared/api';
import { type ClaudeTitleState, claudeTitleState } from '../shared/claudeTitle';
import { edi } from './bridge';
import {
  type CenterState,
  type CenterTarget,
  EMPTY_CENTER,
  activateCenterTab,
  closeCenterTab,
  openTarget,
  pinCenterTab,
  setPanelOpen,
  syncCenter,
} from './center/tabs';
import { clampWidths } from './components/Splitter';
import { HISTORY_MAX, HISTORY_PAGE, historyKey } from './history/model';
import { disposeAllTerminals, disposeTerminal, onTerminalTitle, openTerminal, showTerminal, writeTerminal } from './terminals/terminals';

export interface Tab {
  id: number;
  title: string;
  /** Claude Code is running in the foreground. */
  claude: boolean;
  /** Claude Code is waiting for a reply (shown only on a background tab). */
  waiting: boolean;
  /** A process other than the shell is running: ask before closing. */
  busy: boolean;
  /** The shell exited; the tab stays in place so its output can be read. */
  exited: boolean;
  /**
   * A tab opened with the Claude Code button stays "claude" for a few seconds until the command starts;
   * any "only the shell in the foreground" report until then is ignored.
   */
  claudeUntil: number;
  /** Last Claude Code state read from the terminal title; null if no title has arrived yet. */
  titleState: ClaudeTitleState | null;
}

/** Time allowed for Claude Code to start. */
const CLAUDE_START_MS = 8000;

/** Applies process states from the main process to the tabs. */
export function applyTabStates(tabs: Tab[], states: TabState[], now: number): Tab[] {
  const byId = new Map(states.map((state) => [state.id, state]));
  return tabs.map((tab) => {
    const state = byId.get(tab.id);
    if (!state || tab.exited) return tab;
    if (!state.claude && now < tab.claudeUntil) return tab;
    // If Claude Code exited, both the bell and the state read from the title are stale.
    const waiting = state.claude ? tab.waiting : false;
    const titleState = state.claude ? tab.titleState : null;
    if (
      tab.title === state.title &&
      tab.claude === state.claude &&
      tab.busy === state.busy &&
      tab.waiting === waiting &&
      tab.titleState === titleState
    ) {
      return tab;
    }
    return { ...tab, title: state.title, claude: state.claude, busy: state.busy, waiting, titleState };
  });
}

/**
 * Updates the tab when the terminal title changes. The bell lights only for something that happens
 * while the user isn't looking: when a background Claude tab goes from working to waiting. A freshly
 * opened empty session, or a reply that finishes in front of the user, doesn't light the bell.
 */
export function applyTitle(tab: Tab, title: string, active: boolean): Tab {
  const next = claudeTitleState(title);
  if (next === null || tab.exited || next === tab.titleState) return tab;
  const waiting = next === 'waiting' && tab.titleState === 'working' && tab.claude && !active;
  return { ...tab, titleState: next, waiting };
}

/**
 * Removes the tab from the list. If the active tab closed, the one to its right (or else its left)
 * comes to the front and, as if brought forward with `activate`, its bell goes out.
 */
export function removeTab(tabs: Tab[], activeTab: number | null, id: number): { tabs: Tab[]; activeTab: number | null } {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return { tabs, activeTab };
  const rest = tabs.filter((tab) => tab.id !== id);
  if (activeTab !== id) return { tabs: rest, activeTab };
  const next = rest[Math.min(index, rest.length - 1)]?.id ?? null;
  return { tabs: rest.map((tab) => (tab.id === next && tab.waiting ? { ...tab, waiting: false } : tab)), activeTab: next };
}

export interface HistoryEntry {
  limit: number;
  /** The `historyKey` value: the log is reread when it changes. */
  key: string;
  /** Null until it arrives; the old one stays while rereading. */
  log: LogResult | null;
}

/** Latest request per repo: a stale reply that arrives late doesn't overwrite the newer one. */
const historyRequests = new Map<string, number>();
let historySerial = 0;

interface AppStore {
  /** Whether the initial state has arrived from the main process. */
  ready: boolean;
  home: string;
  workspace: WorkspaceView;
  recent: RecentFolder[];
  layout: Layout;
  /** Why the folder couldn't be opened. */
  openError: string | null;
  openFolder(dir: string): Promise<void>;
  dismissOpenError(): void;
  /** Changes the right panel's width, fitting it into an area `total` wide. */
  resizeRight(right: number, total: number): void;
  /** Changes the left panel's (terminals) width for when the center panel is open. */
  resizeLeft(left: number, total: number): void;
  /** Writes the panel widths to persistent state. */
  saveLayout(): void;

  /** Center panel: open file and diff tabs. */
  center: CenterState;
  /** A single click opens a preview (`pin` false), a double click a permanent tab; opens the panel if closed. */
  openInCenter(target: CenterTarget, pin: boolean): void;
  closeCenterTab(id: string): void;
  activateCenterTab(id: string): void;
  pinCenterTab(id: string): void;
  setCenterOpen(open: boolean): void;
  /** Changes the diff view's layout and remembers it. */
  setDiffMode(mode: Layout['diffMode']): void;
  /** Short info on what's open in the center panel, at the right of the status bar; null if nothing. */
  centerInfo: string | null;
  setCenterInfo(info: string | null): void;

  /** Selected tab in the right panel. */
  rightTab: 'git' | 'history' | 'files';
  setRightTab(tab: 'git' | 'history' | 'files'): void;

  /** History: repo path → the log read, how many commits were requested and which state it was read for. */
  history: Record<string, HistoryEntry>;
  /** The repo History is filtered to; null for all. */
  historyFilter: string | null;
  /** Reads the repo's log (default: the previous count). */
  loadHistory(repoPath: string, limit?: number): Promise<void>;
  /** Reads 50 more commits from every shown repo that has more. */
  loadMoreHistory(): void;
  /** Rereads all logs that have been read. */
  refreshHistory(): void;
  setHistoryFilter(path: string | null): void;
  /** Changes the History layout and remembers it. */
  setHistoryLayout(layout: Layout['historyLayout']): void;
  /** Open folders in the Files tab (`repoPath\nrelativePath`; the relative path is empty for the repo root). */
  filesOpen: Record<string, boolean>;
  toggleFilesDir(key: string, open: boolean): void;
  collapseFiles(): void;

  /** Last error in the center panel (such as "Couldn't open Zed"); null if none. */
  centerError: string | null;
  dismissCenterError(): void;
  /** Opens the file (or the repo folder if the path is null) in Zed; on failure, shows the error in the center panel. */
  openInZed(repoPath: string, path: string | null): Promise<void>;

  tabs: Tab[];
  /** Localhost ports listening in the terminals. */
  servers: ServerInfo[];
  /** Claude usage limits (from the status line bridge); null if unknown. */
  usage: ClaudeUsage | null;
  activeTab: number | null;
  newTab(opts?: { claude?: boolean; repoPath?: string }): Promise<void>;
  closeTab(id: number): void;
  activate(id: number): void;
  /** Closes all tabs (when the folder changes). */
  resetTabs(): void;

  /** Repos in the Git tab that the user expanded or collapsed by hand (for the session). */
  expanded: Record<string, boolean>;
  toggleRepo(repoPath: string, open: boolean): void;

  /** Commit messages being written (repo path → text). */
  drafts: Record<string, string>;
  /** Error from the last git operation (repo path → git's line). */
  errors: Record<string, string>;
  setDraft(repoPath: string, message: string): void;
  dismissError(repoPath: string): void;
  gitOp(repoPath: string, op: GitOp): Promise<void>;
  fetchAll(): Promise<void>;
}

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

const EMPTY: WorkspaceView = { dir: null, repos: [], rootSessions: 0, refreshedAt: 0 };

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  home: '',
  workspace: EMPTY,
  recent: [],
  layout: { left: 492, right: 372, diffMode: 'split', historyLayout: 'timeline' },
  openError: null,
  async openFolder(dir) {
    const result = await edi.openFolder(dir);
    if (!result.ok && result.cancelled) return; // The user cancelled: not an error.
    set({ openError: result.ok ? null : `${dir}: ${result.error}` });
  },
  // The dragged panel's width changes; the other's saved value is kept (CSS shrinks it in a narrow window).
  resizeRight(right, total) {
    set((state) => ({ layout: { ...state.layout, right: clampWidths({ left: state.layout.left, right, total, center: state.center.open }).right } }));
  },
  resizeLeft(left, total) {
    set((state) => ({ layout: { ...state.layout, left: clampWidths({ left, right: state.layout.right, total, center: true }).left } }));
  },
  saveLayout() {
    const { left, right } = get().layout;
    edi.setLayout({ left, right });
  },

  center: EMPTY_CENTER,
  openInCenter: (target, pin) => set((state) => ({ center: openTarget(state.center, target, pin) })),
  closeCenterTab: (id) => set((state) => ({ center: closeCenterTab(state.center, id) })),
  activateCenterTab: (id) => set((state) => ({ center: activateCenterTab(state.center, id) })),
  pinCenterTab: (id) => set((state) => ({ center: pinCenterTab(state.center, id) })),
  setCenterOpen: (open) => set((state) => ({ center: setPanelOpen(state.center, open) })),
  setDiffMode(mode) {
    set((state) => ({ layout: { ...state.layout, diffMode: mode } }));
    edi.setLayout({ diffMode: mode });
  },
  centerInfo: null,
  setCenterInfo: (info) => {
    if (get().centerInfo !== info) set({ centerInfo: info });
  },

  rightTab: 'git',
  setRightTab: (tab) => set({ rightTab: tab }),

  history: {},
  historyFilter: null,
  async loadHistory(repoPath, limit) {
    const repo = get().workspace.repos.find((r) => r.path === repoPath);
    if (!repo) return;
    const previous = get().history[repoPath];
    const entry: HistoryEntry = { limit: limit ?? previous?.limit ?? HISTORY_PAGE, key: historyKey(repo), log: previous?.log ?? null };
    const request = ++historySerial;
    historyRequests.set(repoPath, request);
    set((state) => ({ history: { ...state.history, [repoPath]: entry } }));
    let log: LogResult;
    try {
      log = await edi.log(repoPath, entry.limit);
    } catch (error) {
      log = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (historyRequests.get(repoPath) !== request || !get().history[repoPath]) return;
    set((state) => ({ history: { ...state.history, [repoPath]: { ...entry, log } } }));
  },
  loadMoreHistory() {
    const { history, historyFilter, loadHistory } = get();
    for (const [path, entry] of Object.entries(history)) {
      if (historyFilter !== null && path !== historyFilter) continue;
      if (entry.log?.ok && entry.log.hasMore) void loadHistory(path, Math.min(entry.limit + HISTORY_PAGE, HISTORY_MAX));
    }
  },
  refreshHistory() {
    const { history, loadHistory } = get();
    for (const path of Object.keys(history)) void loadHistory(path);
  },
  setHistoryFilter: (path) => set({ historyFilter: path }),
  setHistoryLayout(layout) {
    set((state) => ({ layout: { ...state.layout, historyLayout: layout } }));
    edi.setLayout({ historyLayout: layout });
  },
  filesOpen: {},
  toggleFilesDir: (key, open) => set((state) => ({ filesOpen: { ...state.filesOpen, [key]: open } })),
  collapseFiles: () => set({ filesOpen: {} }),

  centerError: null,
  dismissCenterError: () => set({ centerError: null }),
  async openInZed(repoPath, path) {
    const result = await edi.openInZed(repoPath, path);
    set({ centerError: result.ok ? null : result.error });
  },
  dismissOpenError: () => set({ openError: null }),

  tabs: [],
  servers: [],
  usage: null,
  activeTab: null,
  async newTab(opts = {}) {
    const dir = get().workspace.dir;
    if (dir === null) return;
    let created;
    try {
      created = await openTerminal(opts);
    } catch {
      return; // The folder closed in the meantime, or the terminal area doesn't exist yet.
    }
    if (get().workspace.dir !== dir) {
      // The folder changed while the terminal was opening: this terminal belongs to the old folder.
      edi.pty.close(created.id);
      disposeTerminal(created.id);
      return;
    }
    const tab: Tab = {
      id: created.id,
      title: opts.claude ? 'claude' : created.title,
      claude: opts.claude === true,
      waiting: false,
      busy: false,
      exited: false,
      claudeUntil: opts.claude ? Date.now() + CLAUDE_START_MS : 0,
      titleState: null,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTab: tab.id }));
    onTerminalTitle(tab.id, (title) =>
      set((state) => ({ tabs: state.tabs.map((other) => (other.id === tab.id ? applyTitle(other, title, state.activeTab === tab.id) : other)) })),
    );
  },
  closeTab(id) {
    const { tabs, activeTab } = get();
    const index = tabs.findIndex((tab) => tab.id === id);
    const tab = tabs[index];
    if (!tab) return;
    if (tab.busy && !tab.exited && !window.confirm('A process is still running in this terminal. Close it?')) return;
    edi.pty.close(id);
    disposeTerminal(id);
    const next = removeTab(tabs, activeTab, id);
    set(next);
    showTerminal(next.activeTab);
  },
  activate(id) {
    if (!get().tabs.some((tab) => tab.id === id)) return;
    set((state) => ({ activeTab: id, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, waiting: false } : tab)) }));
    showTerminal(id);
  },
  resetTabs() {
    disposeAllTerminals();
    set({ tabs: [], activeTab: null });
  },

  expanded: {},
  toggleRepo: (repoPath, open) => set((state) => ({ expanded: { ...state.expanded, [repoPath]: open } })),

  drafts: {},
  errors: {},
  setDraft: (repoPath, message) => set((state) => ({ drafts: { ...state.drafts, [repoPath]: message } })),
  dismissError: (repoPath) => set((state) => ({ errors: without(state.errors, repoPath) })),
  async gitOp(repoPath, op) {
    set((state) => ({ errors: without(state.errors, repoPath) }));
    const result = await edi.git(repoPath, op);
    set((state) => ({
      errors: result.ok ? without(state.errors, repoPath) : { ...state.errors, [repoPath]: result.error },
      // If the commit went through, the message is cleared (the commit stays even if its push failed).
      drafts: op.op === 'commit' && (result.ok || result.error.startsWith('Committed, but')) ? without(state.drafts, repoPath) : state.drafts,
    }));
  },
  async fetchAll() {
    const results = await edi.fetchAll();
    set((state) => {
      let errors = state.errors;
      for (const { repoPath, result } of results) {
        errors = result.ok ? without(errors, repoPath) : { ...errors, [repoPath]: result.error };
      }
      return { errors };
    });
  },
}));

function keepHistory(state: AppStore, workspace: WorkspaceView): Pick<AppStore, 'history' | 'historyFilter'> {
  if (workspace.dir !== state.workspace.dir) return { history: {}, historyFilter: null };
  const paths = new Set(workspace.repos.map((repo) => repo.path));
  const history = Object.fromEntries(Object.entries(state.history).filter(([path]) => paths.has(path)));
  const historyFilter = state.historyFilter !== null && paths.has(state.historyFilter) ? state.historyFilter : null;
  return { history, historyFilter };
}

/** Gets the initial state from the main process and subscribes to changes. The returned function unsubscribes. */
export function connect(): () => void {
  const off = [
    edi.on('workspace', (workspace) =>
      useApp.setState((state) => ({
        workspace,
        // If the folder changed or a repo disappeared, its tabs close.
        center: syncCenter(state.center, state.workspace.dir, workspace.dir, workspace.repos.map((repo) => repo.path)),
        // Switching to another folder starts the Files tree collapsed.
        filesOpen: workspace.dir === state.workspace.dir ? state.filesOpen : {},
        // The old folder's error means nothing in the new folder.
        centerError: workspace.dir === state.workspace.dir ? state.centerError : null,
        // History: starts over in another folder; logs and the filter of vanished repos are dropped.
        ...keepHistory(state, workspace),
        // The old folder's terminals closed; their servers go too (the next poll also sends an empty list).
        servers: workspace.dir === state.workspace.dir ? state.servers : [],
      })),
    ),
    edi.on('recent', (recent) => useApp.setState({ recent })),
    edi.on('servers', (servers) => useApp.setState({ servers })),
    edi.on('usage', (usage) => useApp.setState({ usage })),
    edi.on('pty:data', (id, data) => writeTerminal(id, data)),
    edi.on('tabs', (states) => useApp.setState((state) => ({ tabs: applyTabStates(state.tabs, states, Date.now()) }))),
    edi.on('pty:exit', (id) =>
      useApp.setState((state) => ({
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, exited: true, busy: false, waiting: false } : tab)),
      })),
    ),
  ];
  void edi.getState().then((state) => useApp.setState({ ...state, ready: true }));
  void edi.claudeUsage().then((usage) => useApp.setState({ usage }));
  return () => off.forEach((unsubscribe) => unsubscribe());
}
