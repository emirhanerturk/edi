import { stat } from 'node:fs/promises';
import os from 'node:os';
import { basename, resolve } from 'node:path';
import { type BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from 'electron';
import { listPs } from '../procs.js';
import { readUsage, usageFile } from './claudeUsage.js';
import { serveMedia } from './media.js';
import { type BusyKind, type Question, busyQuestion, discardQuestion, dropStashQuestion, undoCommitQuestion } from './questions.js';
import { MEDIA_SCHEME } from '../shared/media.js';
import { listServers } from '../servers.js';
import { listClaudePids, listClaudeSessions } from '../sessions.js';
import type { AppState, ClaudeUsage, EdiEvents, GitOp, OpenResult, StashMenuAction, TerminalCreated } from '../shared/api.js';
import { AutoFetch } from './autoFetch.js';
import { FileOps } from './fileOps.js';
import { GitOps } from './gitOps.js';
import { PtyManager } from './pty.js';
import { type Persisted, addRecent, loadState, mergeLayout, saveState } from './store.js';
import { tabStates } from './tabs.js';
import { HistoryOps } from './historyOps.js';
import { openUrl } from './openUrl.js';
import { ViewOps } from './viewOps.js';
import { Workspace } from './workspace.js';

/** Process polling: tab names and Claude Code sessions. */
const PROCESSES_MS = 3000;
/** How often the Claude usage file is checked; this is also how a window that has reset drops out. */
const USAGE_MS = 5000;
/** How long to wait for the command to start in a newly opened tab; then one early poll runs. */
const AFTER_CREATE_MS = 700;
/** Rapid layout changes, such as dragging, are held this long and written once. */
const LAYOUT_SAVE_MS = 400;


/** The main process's state and everything it talks to the page about. */
export class AppCore {
  readonly workspace: Workspace;
  readonly ptys: PtyManager;
  readonly gitOps: GitOps;
  readonly autoFetch: AutoFetch;
  readonly viewOps: ViewOps;
  private readonly fileOps: FileOps;
  readonly historyOps: HistoryOps;
  private state: Persisted;
  /** Open files with unsaved edits, as the page last reported. */
  private unsavedFiles = 0;
  private saving: Promise<void> = Promise.resolve();
  private processTimer: NodeJS.Timeout | null = null;
  private pollingProcesses = false;
  private tabsSent = '';
  private serversSent = '[]';
  private usageTimer: NodeJS.Timeout | null = null;
  private usageSent = 'null';
  private readonly usagePath = usageFile(process.env, os.homedir());
  private layoutTimer: NodeJS.Timeout | null = null;

  private constructor(
    private readonly stateFile: string,
    state: Persisted,
    private readonly getWindow: () => BrowserWindow | null,
  ) {
    this.state = state;
    this.workspace = new Workspace({ onChange: (view) => this.send('workspace', view) });
    this.gitOps = new GitOps(this.workspace);
    this.autoFetch = new AutoFetch(
      {
        repos: () => this.workspace.view().repos,
        fetch: (repoPath) => this.gitOps.fetchQuietly(repoPath),
        isOnline: () => net.isOnline(),
      },
      state.autoFetch,
    );
    this.viewOps = new ViewOps(this.workspace);
    this.fileOps = new FileOps(this.workspace, {
      ask: (question) => this.ask(question),
      trash: (target) => shell.trashItem(target),
      reveal: (target) => shell.showItemInFolder(target),
      menu: (items) => this.popup(items),
      choosePath: async (defaultPath) => {
        const win = this.getWindow();
        const options = { defaultPath, properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const] };
        const result = await (win && !win.isDestroyed() ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
        return result.canceled || !result.filePath ? null : result.filePath;
      },
    });
    this.historyOps = new HistoryOps(this.workspace);
    this.ptys = new PtyManager({
      shell: process.env.EDI_SHELL,
      onData: (id, data) => this.send('pty:data', id, data),
      onExit: (id) => this.send('pty:exit', id),
    });
  }

  static async create(stateFile: string, getWindow: () => BrowserWindow | null): Promise<AppCore> {
    return new AppCore(stateFile, await loadState(stateFile), getWindow);
  }

  get persisted(): Persisted {
    return this.state;
  }

  /** Sends an event to the page; does nothing if the window is closed. */
  send<K extends keyof EdiEvents>(channel: K, ...args: EdiEvents[K]): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  /** Writes the state to disk; writes are queued so none overlaps another. */
  update(change: (state: Persisted) => Persisted): void {
    this.state = change(this.state);
    const snapshot = this.state;
    this.saving = this.saving.then(() => saveState(this.stateFile, snapshot)).catch(() => undefined);
  }

  flush(): Promise<void> {
    if (this.layoutTimer) {
      clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
      this.update((state) => state);
    }
    return this.saving;
  }

  /** View > Fetch Automatically. */
  setAutoFetch(enabled: boolean): void {
    this.autoFetch.setEnabled(enabled);
    this.update((state) => ({ ...state, autoFetch: enabled }));
  }

  /** Applies a layout change in memory right away and writes it to disk with a delay. */
  setLayout(patch: unknown): void {
    this.state = { ...this.state, layout: mergeLayout(this.state.layout, patch) };
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null;
      this.update((state) => state);
    }, LAYOUT_SAVE_MS);
  }

  /** The number of terminals running a process other than the shell; the process list is read now. */
  async busyTerminals(): Promise<number> {
    const ptys = this.ptyInfos();
    if (ptys.length === 0) return 0;
    const [ps, pids] = await Promise.all([listPs(), listClaudePids()]);
    return tabStates(ptys, ps, new Set(pids)).filter((tab) => tab.busy).length;
  }

  /** Asks the user if a process is running. True if none is, or if the user confirms. */
  async confirmBusy(kind: BusyKind): Promise<boolean> {
    const busy = await this.busyTerminals().catch(() => 0);
    const question = busyQuestion(kind, busy, this.unsavedFiles);
    return question === null || (await this.ask(question));
  }

  /** A native context menu at the mouse; resolves with the picked item's id, or null when it closes without one. */
  private popup<T extends string>(items: { id: T | null; label: string; enabled?: boolean }[]): Promise<T | null> {
    return new Promise((resolve) => {
      let picked = false;
      const menu = Menu.buildFromTemplate(
        items.map((item) =>
          item.id === null
            ? { type: 'separator' as const }
            : {
                label: item.label,
                enabled: item.enabled !== false,
                click: () => {
                  picked = true;
                  resolve(item.id);
                },
              },
        ),
      );
      const win = this.getWindow();
      // The click handler can run just after the close callback: wait a moment before reporting "nothing".
      const callback = () => setTimeout(() => !picked && resolve(null), 100);
      if (win && !win.isDestroyed()) menu.popup({ window: win, callback });
      else resolve(null);
    });
  }

  /** Shows a native question; true if the first (confirm) button was picked. */
  private async ask(question: Question): Promise<boolean> {
    const win = this.getWindow();
    const { response } = await (win && !win.isDestroyed() ? dialog.showMessageBox(win, question) : dialog.showMessageBox(question));
    return response === 0;
  }

  private ptyInfos() {
    return this.ptys.ids().flatMap((id) => {
      const info = this.ptys.info(id);
      return info ? [{ id, ...info }] : [];
    });
  }

  async openFolder(dir: string): Promise<OpenResult> {
    const previous = this.workspace.view().dir;
    // Changing folders closes the terminals: if a process is running, ask first.
    if (previous !== null && resolve(dir) !== previous && (await stat(dir).then((s) => s.isDirectory(), () => false))) {
      if (!(await this.confirmBusy('switch'))) return { ok: false, error: 'Cancelled', cancelled: true };
    }
    const result = await this.workspace.open(dir);
    if (!result.ok) return result;
    const opened = this.workspace.view().dir ?? dir;
    // Terminals belong to the open folder: they close when it changes, and the page opens new ones.
    if (opened !== previous) this.ptys.killAll();
    this.update((state) => ({ ...addRecent(state, opened, result.repoCount), lastDir: opened }));
    this.send('workspace', this.workspace.view());
    this.send('recent', this.state.recent);
    void this.pollProcesses();
    return { ok: true };
  }

  /** On startup: the requested folder, otherwise the last one opened (if it still exists). */
  async openInitial(requested: string | undefined): Promise<void> {
    const dir = requested ?? this.state.lastDir;
    if (!dir) return;
    const exists = await stat(dir).then((s) => s.isDirectory(), () => false);
    if (exists) await this.openFolder(dir);
  }

  appState(): AppState {
    return { home: os.homedir(), workspace: this.workspace.view(), recent: this.state.recent, layout: this.state.layout };
  }

  register(): void {
    // Images and videos in the file view: only from inside discovered repos.
    protocol.handle(MEDIA_SCHEME, (request) =>
      serveMedia((repoPath) => this.workspace.repo(repoPath)?.path ?? null, request.url, request.headers.get('range')),
    );
    ipcMain.handle('state:get', () => this.appState());
    ipcMain.handle('folder:choose', async () => {
      const win = this.getWindow();
      if (!win) return;
      const picked = await dialog.showOpenDialog(win, {
        title: 'Open a folder',
        buttonLabel: 'Open',
        defaultPath: this.workspace.view().dir ?? os.homedir(),
        properties: ['openDirectory'],
      });
      const dir = picked.filePaths[0];
      if (!picked.canceled && dir) await this.openFolder(dir);
    });
    ipcMain.handle('folder:open', (_event, dir: unknown) =>
      typeof dir === 'string' ? this.openFolder(dir) : { ok: false, error: 'Folder not found' },
    );
    ipcMain.handle('workspace:rescan', () => this.workspace.rescan());
    ipcMain.on('layout:set', (_event, patch: unknown) => this.setLayout(patch));

    // The repo path and operation are validated in GitOps; nothing free-form reaches git from here.
    ipcMain.handle('git:run', (_event, repoPath: unknown, op: unknown) => this.gitOps.run(repoPath as string, op as GitOp));
    ipcMain.handle('git:fetchAll', () => this.gitOps.fetchAll());
    ipcMain.handle('git:branches', (_event, repoPath: unknown) => this.gitOps.branches(repoPath as string));
    ipcMain.handle('git:unpushed', (_event, repoPath: unknown) => this.gitOps.unpushed(repoPath));
    ipcMain.handle('git:stashes', (_event, repoPath: unknown) => this.gitOps.stashes(repoPath));
    ipcMain.handle('git:stash', (_event, repoPath: unknown, oid: unknown) => this.gitOps.stash(repoPath, oid));
    ipcMain.handle('git:stashMenu', (_event, canApply: unknown) => {
      const apply = canApply === true;
      return this.popup<StashMenuAction>([
        { id: 'pop', label: 'Pop', enabled: apply },
        { id: 'apply', label: 'Apply', enabled: apply },
        { id: null, label: '-' },
        { id: 'drop', label: 'Drop…' },
      ]);
    });
    ipcMain.handle('git:confirmDropStash', (_event, label: unknown) => this.ask(dropStashQuestion(typeof label === 'string' ? label : 'this stash')));
    // Read-only view operations: paths are validated in ViewOps.
    ipcMain.handle('view:diff', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.diff(repoPath, filePath));
    ipcMain.on('edits:unsaved', (_event, count: unknown) => {
      this.unsavedFiles = typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0;
    });
    ipcMain.handle('git:confirmUndo', (_event, subject: unknown) => this.ask(undoCommitQuestion(typeof subject === 'string' ? subject : 'this commit')));
    ipcMain.handle('edits:confirmDiscard', (_event, name: unknown) => this.ask(discardQuestion(typeof name === 'string' ? name : 'this file')));
    ipcMain.handle('view:read', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.readFile(repoPath, filePath));
    ipcMain.handle('files:create', (_event, repoPath: unknown, path: unknown, kind: unknown) => this.fileOps.create(repoPath, path, kind));
    ipcMain.handle('files:rename', (_event, repoPath: unknown, path: unknown, name: unknown, unsaved: unknown) =>
      this.fileOps.rename(repoPath, path, name, unsaved),
    );
    ipcMain.handle('files:trash', (_event, repoPath: unknown, path: unknown, unsaved: unknown) => this.fileOps.trash(repoPath, path, unsaved));
    ipcMain.handle('files:reveal', (_event, repoPath: unknown, path: unknown) => this.fileOps.reveal(repoPath, path));
    ipcMain.handle('files:menu', (_event, kind: unknown) => this.fileOps.menu(kind));
    ipcMain.handle('files:saveNew', (_event, text: unknown, repoPath: unknown) => this.fileOps.saveNew(text, repoPath));
    ipcMain.handle('view:headText', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.headText(repoPath, filePath));
    ipcMain.handle('view:blame', (_event, repoPath: unknown, filePath: unknown, text: unknown) => this.viewOps.blame(repoPath, filePath, text));
    ipcMain.handle('view:write', (_event, repoPath: unknown, filePath: unknown, text: unknown, expected: unknown) =>
      this.viewOps.writeFile(repoPath, filePath, text, expected),
    );
    ipcMain.handle('view:list', (_event, repoPath: unknown) => this.viewOps.listFiles(repoPath));
    ipcMain.handle('view:listDir', (_event, repoPath: unknown, dirPath: unknown) => this.viewOps.listDir(repoPath, dirPath));
    ipcMain.handle('view:openInZed', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.openInZed(repoPath, filePath));
    ipcMain.handle('shell:openUrl', (_event, url: unknown) => openUrl(url));
    ipcMain.handle('history:log', (_event, repoPath: unknown, count: unknown) => this.historyOps.log(repoPath, count));
    ipcMain.handle('history:commit', (_event, repoPath: unknown, oid: unknown) => this.historyOps.commit(repoPath, oid));

    ipcMain.handle('pty:create', (_event, o: unknown): TerminalCreated => {
      const opts = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
      const dir = this.workspace.view().dir;
      if (dir === null) throw new Error('No folder is open');
      // The path from the page isn't free: only a discovered repo or the open folder.
      const repo = typeof opts.repoPath === 'string' ? this.workspace.repo(opts.repoPath) : null;
      if (typeof opts.repoPath === 'string' && !repo) throw new Error('Unknown repository');
      const id = this.ptys.create({
        cols: Number(opts.cols),
        rows: Number(opts.rows),
        cwd: repo?.path ?? dir,
        command: opts.claude === true ? 'claude' : undefined,
      });
      setTimeout(() => void this.pollProcesses(), AFTER_CREATE_MS);
      return { id, title: basename(this.ptys.info(id)?.shell ?? 'shell') };
    });
    ipcMain.on('pty:write', (_event, id: unknown, data: unknown) => {
      if (typeof id === 'number' && typeof data === 'string') this.ptys.write(id, data);
    });
    ipcMain.on('pty:resize', (_event, id: unknown, cols: unknown, rows: unknown) => {
      if (typeof id === 'number' && typeof cols === 'number' && typeof rows === 'number') this.ptys.resize(id, cols, rows);
    });
    ipcMain.on('pty:close', (_event, id: unknown) => {
      if (typeof id === 'number') this.ptys.kill(id);
    });

    this.processTimer = setInterval(() => void this.pollProcesses(), PROCESSES_MS);

    ipcMain.handle('usage:get', () => this.readUsage());
    this.usageTimer = setInterval(() => void this.pollUsage(), USAGE_MS);
    this.autoFetch.start();
  }

  private async readUsage(): Promise<ClaudeUsage | null> {
    const usage = await readUsage(this.usagePath);
    this.usageSent = JSON.stringify(usage);
    return usage;
  }

  /** Sent to the page when the usage file changes (or a window resets). */
  private async pollUsage(): Promise<void> {
    const usage = await readUsage(this.usagePath);
    const json = JSON.stringify(usage);
    if (json === this.usageSent) return;
    this.usageSent = json;
    this.send('usage', usage);
  }

  dispose(): void {
    if (this.processTimer) clearInterval(this.processTimer);
    this.processTimer = null;
    if (this.usageTimer) clearInterval(this.usageTimer);
    this.usageTimer = null;
    this.autoFetch.dispose();
    this.workspace.dispose();
    this.ptys.killAll();
  }

  /** Reads the process list once and derives both the tab states and the Claude Code sessions from it. */
  private async pollProcesses(): Promise<void> {
    if (this.pollingProcesses || this.workspace.view().dir === null) return;
    this.pollingProcesses = true;
    try {
      const [ps, pids] = await Promise.all([listPs(), listClaudePids()]);

      const ptys = this.ptyInfos();
      const tabs = tabStates(ptys, ps, new Set(pids));
      // Sent only on change, so the page isn't needlessly redrawn every three seconds.
      const serialized = JSON.stringify(tabs);
      if (serialized !== this.tabsSent) {
        this.tabsSent = serialized;
        this.send('tabs', tabs);
      }

      // Localhost ports opened for listening in the terminals; sent only on change.
      const servers = await listServers(ptys, ps);
      const serversJson = JSON.stringify(servers);
      if (serversJson !== this.serversSent) {
        this.serversSent = serversJson;
        this.send('servers', servers);
      }

      const sessions = await listClaudeSessions(ps, pids);
      this.workspace.setSessionCwds(sessions.map((session) => session.cwd));
    } finally {
      this.pollingProcesses = false;
    }
  }
}
