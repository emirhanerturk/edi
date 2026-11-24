import { stat } from 'node:fs/promises';
import os from 'node:os';
import { basename } from 'node:path';
import { type BrowserWindow, dialog, ipcMain } from 'electron';
import { listPs } from '../procs.js';
import { listClaudePids, listClaudeSessions } from '../sessions.js';
import type { AppState, EdiEvents, OpenResult, TerminalCreated } from '../shared/api.js';
import { PtyManager } from './pty.js';
import { type Persisted, addRecent, loadState, saveState } from './store.js';
import { Workspace } from './workspace.js';

const SESSIONS_MS = 3000;

/** Ana sürecin durumu ve sayfayla konuştuğu her şey. */
export class AppCore {
  readonly workspace: Workspace;
  readonly ptys: PtyManager;
  private state: Persisted;
  private saving: Promise<void> = Promise.resolve();
  private sessionsTimer: NodeJS.Timeout | null = null;
  private pollingSessions = false;

  private constructor(
    private readonly stateFile: string,
    state: Persisted,
    private readonly getWindow: () => BrowserWindow | null,
  ) {
    this.state = state;
    this.workspace = new Workspace({ onChange: (view) => this.send('workspace', view) });
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

  /** Sayfaya olay gönderir; pencere kapanmışsa sessizce geçer. */
  send<K extends keyof EdiEvents>(channel: K, ...args: EdiEvents[K]): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  /** Durumu diske yazar; yazmalar sıraya girer, biri diğerinin üstüne binmez. */
  update(change: (state: Persisted) => Persisted): void {
    this.state = change(this.state);
    const snapshot = this.state;
    this.saving = this.saving.then(() => saveState(this.stateFile, snapshot)).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.saving;
  }

  async openFolder(dir: string): Promise<OpenResult> {
    const previous = this.workspace.view().dir;
    const result = await this.workspace.open(dir);
    if (!result.ok) return result;
    const opened = this.workspace.view().dir ?? dir;
    // Terminaller açık klasöre aittir: klasör değişince kapanır, sayfa yenilerini açar.
    if (opened !== previous) this.ptys.killAll();
    this.update((state) => ({ ...addRecent(state, opened, result.repoCount), lastDir: opened }));
    this.send('workspace', this.workspace.view());
    this.send('recent', this.state.recent);
    void this.pollSessions();
    return { ok: true };
  }

  /** Açılışta: istenen klasör, yoksa son açılan (hâlâ duruyorsa). */
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

    ipcMain.handle('pty:create', (_event, o: unknown): TerminalCreated => {
      const opts = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
      const dir = this.workspace.view().dir;
      if (dir === null) throw new Error('No folder is open');
      // Sayfadan gelen yol serbest değildir: yalnız keşfedilmiş bir repo ya da açık klasör.
      const repo = typeof opts.repoPath === 'string' ? this.workspace.repo(opts.repoPath) : null;
      if (typeof opts.repoPath === 'string' && !repo) throw new Error('Unknown repository');
      const id = this.ptys.create({
        cols: Number(opts.cols),
        rows: Number(opts.rows),
        cwd: repo?.path ?? dir,
        command: opts.claude === true ? 'claude' : undefined,
      });
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

    this.sessionsTimer = setInterval(() => void this.pollSessions(), SESSIONS_MS);
  }

  dispose(): void {
    if (this.sessionsTimer) clearInterval(this.sessionsTimer);
    this.workspace.dispose();
    this.ptys.killAll();
  }

  /** Terminalde açık Claude Code oturumlarını repo satırlarına yazar. */
  private async pollSessions(): Promise<void> {
    if (this.pollingSessions || this.workspace.view().dir === null) return;
    this.pollingSessions = true;
    try {
      const [ps, pids] = await Promise.all([listPs(), listClaudePids()]);
      const sessions = await listClaudeSessions(ps, pids);
      this.workspace.setSessionCwds(sessions.map((session) => session.cwd));
    } finally {
      this.pollingSessions = false;
    }
  }
}
