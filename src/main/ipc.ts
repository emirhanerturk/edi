import { stat } from 'node:fs/promises';
import os from 'node:os';
import { basename, resolve } from 'node:path';
import { type BrowserWindow, dialog, ipcMain } from 'electron';
import { listPs } from '../procs.js';
import { readUsage, usageFile } from './claudeUsage.js';
import { listServers } from '../servers.js';
import { listClaudePids, listClaudeSessions } from '../sessions.js';
import type { AppState, ClaudeUsage, EdiEvents, GitOp, OpenResult, TerminalCreated } from '../shared/api.js';
import { GitOps } from './gitOps.js';
import { PtyManager } from './pty.js';
import { type Persisted, addRecent, loadState, mergeLayout, saveState } from './store.js';
import { tabStates } from './tabs.js';
import { HistoryOps } from './historyOps.js';
import { openUrl } from './openUrl.js';
import { ViewOps } from './viewOps.js';
import { Workspace } from './workspace.js';

/** Süreç yoklaması: sekme adları ve Claude Code oturumları. */
const PROCESSES_MS = 3000;
/** Claude kullanım dosyasına bakma aralığı; sıfırlanan pencere de böyle düşer. */
const USAGE_MS = 5000;
/** Yeni açılan sekmede komutun başlaması için beklenen süre; sonra bir kez erken yoklanır. */
const AFTER_CREATE_MS = 700;
/** Sürükleme gibi art arda gelen düzen değişiklikleri bu kadar bekletilip bir kez yazılır. */
const LAYOUT_SAVE_MS = 400;

const QUESTIONS = {
  quit: { message: 'Quit edi?', suffix: '', confirm: 'Quit' },
  switch: { message: 'Switch folders?', suffix: ' Switching closes every terminal.', confirm: 'Switch' },
} as const;

/** Ana sürecin durumu ve sayfayla konuştuğu her şey. */
export class AppCore {
  readonly workspace: Workspace;
  readonly ptys: PtyManager;
  readonly gitOps: GitOps;
  readonly viewOps: ViewOps;
  readonly historyOps: HistoryOps;
  private state: Persisted;
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
    this.viewOps = new ViewOps(this.workspace);
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
    if (this.layoutTimer) {
      clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
      this.update((state) => state);
    }
    return this.saving;
  }

  /** Düzen değişikliğini hemen belleğe alır, diske gecikmeli yazar. */
  setLayout(patch: unknown): void {
    this.state = { ...this.state, layout: mergeLayout(this.state.layout, patch) };
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null;
      this.update((state) => state);
    }, LAYOUT_SAVE_MS);
  }

  /** Kabuğun dışında süreç çalıştıran terminal sayısı; süreç listesi şimdi okunur. */
  async busyTerminals(): Promise<number> {
    const ptys = this.ptyInfos();
    if (ptys.length === 0) return 0;
    const [ps, pids] = await Promise.all([listPs(), listClaudePids()]);
    return tabStates(ptys, ps, new Set(pids)).filter((tab) => tab.busy).length;
  }

  /** Çalışan süreç varsa kullanıcıya sorar. Yoksa ya da onaylanırsa true. */
  async confirmBusy(kind: keyof typeof QUESTIONS): Promise<boolean> {
    const busy = await this.busyTerminals().catch(() => 0);
    if (busy === 0) return true;
    const { message, suffix, confirm } = QUESTIONS[kind];
    const options = {
      type: 'warning' as const,
      message,
      detail: `${busy} ${busy === 1 ? 'terminal still has' : 'terminals still have'} a running process.${suffix}`,
      buttons: [confirm, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    };
    const win = this.getWindow();
    const { response } = await (win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
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
    // Klasör değişince terminaller kapanır: çalışan süreç varsa önce sorulur.
    if (previous !== null && resolve(dir) !== previous && (await stat(dir).then((s) => s.isDirectory(), () => false))) {
      if (!(await this.confirmBusy('switch'))) return { ok: false, error: 'Cancelled', cancelled: true };
    }
    const result = await this.workspace.open(dir);
    if (!result.ok) return result;
    const opened = this.workspace.view().dir ?? dir;
    // Terminaller açık klasöre aittir: klasör değişince kapanır, sayfa yenilerini açar.
    if (opened !== previous) this.ptys.killAll();
    this.update((state) => ({ ...addRecent(state, opened, result.repoCount), lastDir: opened }));
    this.send('workspace', this.workspace.view());
    this.send('recent', this.state.recent);
    void this.pollProcesses();
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
    ipcMain.on('layout:set', (_event, patch: unknown) => this.setLayout(patch));

    // Repo yolu ve işlem GitOps'ta doğrulanır; buradan git'e serbest biçimli hiçbir şey geçmez.
    ipcMain.handle('git:run', (_event, repoPath: unknown, op: unknown) => this.gitOps.run(repoPath as string, op as GitOp));
    ipcMain.handle('git:fetchAll', () => this.gitOps.fetchAll());
    ipcMain.handle('git:branches', (_event, repoPath: unknown) => this.gitOps.branches(repoPath as string));
    // Salt okunur görünüm işlemleri: yollar ViewOps içinde doğrulanır.
    ipcMain.handle('view:diff', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.diff(repoPath, filePath));
    ipcMain.handle('view:read', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.readFile(repoPath, filePath));
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
      // Sayfadan gelen yol serbest değildir: yalnız keşfedilmiş bir repo ya da açık klasör.
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
  }

  private async readUsage(): Promise<ClaudeUsage | null> {
    const usage = await readUsage(this.usagePath);
    this.usageSent = JSON.stringify(usage);
    return usage;
  }

  /** Kullanım dosyası değişince (ya da bir pencere sıfırlanınca) sayfaya gönderilir. */
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
    this.workspace.dispose();
    this.ptys.killAll();
  }

  /** Süreç listesini bir kez okur; ondan hem sekme durumlarını hem Claude Code oturumlarını çıkarır. */
  private async pollProcesses(): Promise<void> {
    if (this.pollingProcesses || this.workspace.view().dir === null) return;
    this.pollingProcesses = true;
    try {
      const [ps, pids] = await Promise.all([listPs(), listClaudePids()]);

      const ptys = this.ptyInfos();
      const tabs = tabStates(ptys, ps, new Set(pids));
      // Yalnız değişince gönderilir: sayfa her üç saniyede boşuna yeniden çizilmez.
      const serialized = JSON.stringify(tabs);
      if (serialized !== this.tabsSent) {
        this.tabsSent = serialized;
        this.send('tabs', tabs);
      }

      // Terminallerde dinlemeye açılmış localhost portları; yalnız değişince gönderilir.
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
