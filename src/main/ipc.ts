import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type BrowserWindow, ClipboardItem, Menu, type MenuItemConstructorOptions, clipboard, dialog, ipcMain, net, powerSaveBlocker, protocol, shell } from 'electron';
import { discoverRepos } from '../git/discover.js';
import { locateInRepo } from '../git/files.js';
import { remoteWebUrl } from '../git/remoteUrl.js';
import { listPs } from '../procs.js';
import { readUsage, usageFile } from './claudeUsage.js';
import { LOGO_EXTENSIONS, LogoCandidates, checkLogo, dropLogo, findLogos, logoUrl, serveLogo, storeLogo } from './logos.js';
import { serveMedia } from './media.js';
import { type ProjectTemplate, byOpened, cleanInput, markOpened } from './projects.js';
import {
  type BusyKind,
  type Question,
  busyQuestion,
  discardChangesQuestion,
  discardQuestion,
  discardTarget,
  dropStashQuestion,
  replaceAllQuestion,
  removeProjectQuestion,
  revertCommitQuestion,
  undoCommitQuestion,
} from './questions.js';
import { MEDIA_SCHEME } from '../shared/media.js';
import { LOGO_SCHEME, linkName } from '../shared/projects.js';
import { listServers } from '../servers.js';
import { listClaudePids, listClaudeSessions } from '../sessions.js';
import type {
  AppState,
  ChosenLogo,
  ClaudeUsage,
  EdiEvents,
  GitOp,
  Layout,
  OpenResult,
  Project,
  ProjectDraft,
  ProjectInput,
  ProjectLogo,
  ProjectMenuAction,
  ProjectView,
  ServerInfo,
  StashMenuAction,
  TerminalCreated,
} from '../shared/api.js';
import { AutoFetch } from './autoFetch.js';
import { KeepAwake } from './keepAwake.js';
import { FileOps } from './fileOps.js';
import { gitFileMenuItems, gitFileMenuState } from './gitMenu.js';
import { GitOps } from './gitOps.js';
import { PtyManager } from './pty.js';
import { type Persisted, loadState, mergeLayout, saveState, saveStateSync } from './store.js';
import { tabStates } from './tabs.js';
import { HistoryOps } from './historyOps.js';
import { SearchOps } from './searchOps.js';
import { openUrl } from './openUrl.js';
import { Serial } from './serial.js';
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

const CANCELLED = { ok: false, error: 'Cancelled', cancelled: true } as const;
const NO_PROJECT = { ok: false, error: 'Project not found' } as const;
const isDir = (path: string) => stat(path).then((info) => info.isDirectory(), () => false);
/** The folder's real path, or null if it isn't a folder. */
const realDir = async (path: string): Promise<string | null> => {
  try {
    const real = await realpath(path);
    return (await isDir(real)) ? real : null;
  } catch {
    return null;
  }
};
const takenBy = (project: Project) => ({ ok: false, error: `This folder is already the project ${project.name}` }) as const;

/** An item of a native menu: a separator without an id or submenu. */
interface PopupItem<T extends string> {
  id: T | null;
  label: string;
  enabled?: boolean;
  /** The key shown beside it. */
  accelerator?: string;
  submenu?: PopupItem<T>[];
}


/** The main process's state and everything it talks to the page about. */
export class AppCore {
  readonly workspace: Workspace;
  readonly ptys: PtyManager;
  readonly gitOps: GitOps;
  readonly autoFetch: AutoFetch;
  private readonly keepAwake: KeepAwake;
  readonly viewOps: ViewOps;
  private readonly fileOps: FileOps;
  readonly historyOps: HistoryOps;
  readonly searchOps: SearchOps;
  private state: Persisted;
  /** Open files with unsaved edits, as the page last reported. */
  private unsavedFiles = 0;
  /** Terminals running a process other than the shell, as of the last process poll. */
  private busyTabs = 0;
  private saving: Promise<void> = Promise.resolve();
  private processTimer: NodeJS.Timeout | null = null;
  private pollingProcesses = false;
  /**
   * Moves on whenever the terminals change (one is closed or exits, the folder switches): a process poll
   * that began before is out of date, so its result is dropped and the poll runs again.
   */
  private terminalsChanged = 0;
  private tabsSent = '';
  private servers: ServerInfo[] = [];
  private serversSent = '[]';
  private usageTimer: NodeJS.Timeout | null = null;
  private usageSent = 'null';
  private readonly usagePath = usageFile(process.env, os.homedir());
  private layoutTimer: NodeJS.Timeout | null = null;
  private readonly opening = new Serial<OpenResult>();
  /** Where edi keeps its copies of the projects' logos. */
  private readonly logoFolder: string;
  /** The images offered in the sheet: the only ones, besides edi's copies, the page can show or have copied. */
  private readonly logos = new LogoCandidates();
  /** The page asked for its first state: from then on a New project sheet goes to it as an event. */
  private pageLoaded = false;
  /** The sheet `edi <folder>` asked for before the page had loaded; handed over with the first state. */
  private pendingDraft: ProjectDraft | null = null;
  /** The latest projects list being put together: an older one finishing later isn't sent over it. */
  private projectsSent = 0;

  private constructor(
    private readonly stateFile: string,
    state: Persisted,
    private readonly getWindow: () => BrowserWindow | null,
  ) {
    this.state = state;
    this.logoFolder = join(dirname(stateFile), 'logos');
    this.workspace = new Workspace({ onChange: (view) => this.send('workspace', view) });
    this.gitOps = new GitOps(this.workspace, { trash: (target) => shell.trashItem(target) });
    this.autoFetch = new AutoFetch(
      {
        repos: () => this.workspace.view().repos,
        fetch: (repoPath) => this.gitOps.fetchQuietly(repoPath),
        isOnline: () => net.isOnline(),
      },
      state.autoFetch,
    );
    this.keepAwake = new KeepAwake(powerSaveBlocker, state.keepAwake);
    this.viewOps = new ViewOps(this.workspace);
    this.fileOps = new FileOps(this.workspace, {
      ask: (question) => this.ask(question),
      trash: (target) => shell.trashItem(target),
      reveal: (target) => shell.showItemInFolder(target),
      // Finder pastes the file from its URL on the pasteboard; a terminal or an editor gets its path.
      copyToClipboard: (target) => {
        const item = new ClipboardItem({ 'text/plain': target, 'electron application/osclipboard;format="public.file-url"': pathToFileURL(target).href });
        void clipboard.write([item]).catch(() => clipboard.writeText(target).catch(() => undefined));
      },
      menu: (items) => this.popup(items),
      choosePath: async (defaultPath) => {
        const win = this.getWindow();
        const options = { defaultPath, properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const] };
        const result = await (win && !win.isDestroyed() ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
        return result.canceled || !result.filePath ? null : result.filePath;
      },
    });
    this.historyOps = new HistoryOps(this.workspace, { menu: (items) => this.popup(items) });
    this.searchOps = new SearchOps(this.workspace);
    this.ptys = new PtyManager({
      // A shell set through EDI_SHELL is the tests': it doesn't read the profile of whoever runs them.
      shell: process.env.EDI_SHELL,
      login: process.env.EDI_SHELL === undefined,
      onData: (id, data) => this.send('pty:data', id, data),
      onExit: (id) => {
        this.send('pty:exit', id);
        this.terminalGone(id);
      },
    });
  }

  /** A terminal closed or exited: its servers leave the list now, not at the next poll. */
  private terminalGone(id: number): void {
    this.terminalsChanged++;
    this.sendServers(this.servers.filter((server) => server.tabId !== id));
    void this.pollProcesses();
  }

  /** Sent only on change, so the page isn't redrawn needlessly. */
  private sendServers(servers: ServerInfo[]): void {
    this.servers = servers;
    const json = JSON.stringify(servers);
    if (json === this.serversSent) return;
    this.serversSent = json;
    this.send('servers', servers);
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

  /**
   * Writes the state to disk before returning, for an exit that can't wait. A write still queued would
   * carry an older state: once the queue is done, the current one is written again.
   */
  saveNow(): void {
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = null;
    const snapshot = this.state;
    try {
      saveStateSync(this.stateFile, snapshot);
    } catch {
      // Nothing to be done about it while the app exits.
    }
    this.saving = this.saving.then(() => saveStateSync(this.stateFile, snapshot)).catch(() => undefined);
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

  /** View > Keep Mac Awake. */
  setKeepAwake(enabled: boolean): void {
    this.keepAwake.setEnabled(enabled);
    this.update((state) => ({ ...state, keepAwake: enabled }));
  }

  /** View > Layout: which side the terminal panel is on. The page follows at once. */
  setTerminalSide(side: Layout['terminals']): void {
    this.setLayout({ terminals: side });
    this.send('layout', this.state.layout);
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

  /** The repos running an operation the user started: a busy label (the automatic fetch shows none). */
  private gitRepos(): string[] {
    return this.workspace.view().repos.filter((repo) => repo.busy !== null).map((repo) => repo.name);
  }

  /** Asks the user if a process or a git operation is running. True if none is, or if the user confirms. */
  async confirmBusy(kind: BusyKind): Promise<boolean> {
    const busy = await this.busyTerminals().catch(() => 0);
    const question = busyQuestion(kind, busy, this.unsavedFiles, this.gitRepos());
    return question === null || (await this.ask(question));
  }

  /**
   * Whether quitting would ask anything, answered at once: the terminals as of the last process poll
   * (at most a few seconds old) instead of a fresh read.
   */
  wouldAskToQuit(): boolean {
    return busyQuestion('quit', this.busyTabs, this.unsavedFiles, this.gitRepos()) !== null;
  }

  /**
   * A native context menu at the mouse; resolves with the picked item's id, or null when it closes without
   * one. An item with a `submenu` opens it; one without an id and submenu is a separator. `accelerator`
   * only shows the key: the page handles it.
   */
  private popup<T extends string>(items: PopupItem<T>[]): Promise<T | null> {
    return new Promise((resolve) => {
      let picked = false;
      const build = (list: PopupItem<T>[]): MenuItemConstructorOptions[] =>
        list.map((item) => {
          if (item.submenu) return { label: item.label, enabled: item.enabled !== false, submenu: build(item.submenu) };
          if (item.id === null) return { type: 'separator' as const };
          const id = item.id;
          return {
            label: item.label,
            enabled: item.enabled !== false,
            ...(item.accelerator ? { accelerator: item.accelerator, registerAccelerator: false } : {}),
            click: () => {
              picked = true;
              resolve(id);
            },
          };
        });
      const menu = Menu.buildFromTemplate(build(items));
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

  /**
   * Opens a folder. Requests run one at a time: two at once could mix one folder's repos into the
   * other, and the second's terminal cleanup could kill a terminal just opened in the first. A request
   * for a folder already being opened (a double click) shares that one's result. Once open, the
   * folder's project is marked opened; a folder without one gets one, from `template` if given.
   */
  openFolder(dir: string, template?: ProjectTemplate): Promise<OpenResult> {
    return this.opening.run(resolve(dir), () => this.openFolderNow(dir, template));
  }

  private async openFolderNow(dir: string, template?: ProjectTemplate): Promise<OpenResult> {
    const previous = this.workspace.view().dir;
    // Changing folders closes the terminals: if a process is running, ask first.
    if (previous !== null && resolve(dir) !== previous && (await isDir(dir))) {
      if (!(await this.confirmBusy('switch'))) return CANCELLED;
    }
    // The project's repo order and ignored repos: the sheet's for a new project, else the folder's project's.
    const repos = template?.repos ?? this.projectFor((await realDir(dir)) ?? dir)?.repos;
    const result = await this.workspace.open(dir, repos);
    if (!result.ok) return result;
    const opened = this.workspace.view().dir ?? dir;
    // Terminals belong to the open folder: they close when it changes, and the page opens new ones.
    if (opened !== previous) {
      this.ptys.killAll();
      this.terminalsChanged++;
      this.sendServers([]);
    }
    const now = Date.now();
    this.update((state) => ({ ...state, projects: markOpened(state.projects, opened, result.repoCount, now, template) }));
    this.send('workspace', this.workspace.view());
    void this.sendProjects();
    void this.pollProcesses();
    return { ok: true };
  }

  /** Closes the open folder and its terminals: the page shows the Projects screen. */
  private closeFolder(): Promise<OpenResult> {
    return this.opening.run('\0close', async () => {
      this.workspace.close();
      this.ptys.killAll();
      this.terminalsChanged++;
      // No terminal is left to ask about on quit; no poll runs without a folder to say so.
      this.busyTabs = 0;
      this.sendServers([]);
      this.send('workspace', this.workspace.view());
      return { ok: true };
    });
  }

  /**
   * On startup nothing opens on its own: the page shows the Projects screen. `requested` (from
   * `edi <folder>`) opens that folder's project, or the New project sheet for a folder that isn't one.
   * `direct` (EDI_OPEN_DIR, for tests and development) opens the folder as it is, making it a project if needed.
   */
  async openInitial(requested: string | undefined, direct: string | undefined): Promise<void> {
    if (requested !== undefined) await this.openRequested(requested);
    else if (direct !== undefined && (await isDir(direct))) await this.openFolder(direct);
  }

  /** `edi <folder>`: the folder's project opens; for a folder that isn't a project yet the page shows the New project sheet. */
  async openRequested(dir: string): Promise<void> {
    const real = await realDir(dir);
    if (real === null) return;
    if (this.projectFor(real)) {
      await this.openFolder(real);
      return;
    }
    const draft = await this.draftFor(real, null);
    if (this.pageLoaded) this.send('project:draft', draft);
    else this.pendingDraft = draft;
  }

  async appState(): Promise<AppState> {
    this.pageLoaded = true;
    const draft = this.pendingDraft;
    this.pendingDraft = null;
    return { home: os.homedir(), workspace: this.workspace.view(), projects: await this.projectViews(), draft, layout: this.state.layout };
  }

  private project(id: unknown): Project | null {
    return typeof id === 'string' ? (this.state.projects.find((project) => project.id === id) ?? null) : null;
  }

  private projectFor(dir: string): Project | null {
    return this.state.projects.find((project) => project.dir === dir) ?? null;
  }

  private isOpen(project: Project): boolean {
    return this.workspace.view().dir === project.dir;
  }

  /** The projects as the page sees them: last opened first, with whether each folder is still there. */
  private projectViews(): Promise<ProjectView[]> {
    return Promise.all(
      byOpened(this.state.projects).map(async (project) => ({
        ...project,
        logoUrl: project.logo.kind === 'image' ? logoUrl(project.logo.file) : null,
        exists: await isDir(project.dir),
        open: this.isOpen(project),
      })),
    );
  }

  private async sendProjects(): Promise<void> {
    const serial = ++this.projectsSent;
    const views = await this.projectViews();
    if (serial === this.projectsSent) this.send('projects', views);
  }

  private changeProjects(change: (projects: Project[]) => Project[]): void {
    this.update((state) => ({ ...state, projects: change(state.projects) }));
    void this.sendProjects();
  }

  /** The folder panel; the chosen folder's real path, or null if cancelled. */
  private async pickFolder(title: string, defaultPath: string): Promise<string | null> {
    const win = this.getWindow();
    const options = { title, buttonLabel: 'Choose', defaultPath, properties: ['openDirectory' as const, 'createDirectory' as const] };
    const picked = await (win && !win.isDestroyed() ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    const dir = picked.filePaths[0];
    return picked.canceled || !dir ? null : realDir(dir);
  }

  /** Where the folder panel starts for a new project: beside the last one opened, as projects tend to sit together. */
  private async newProjectPlace(): Promise<string> {
    const last = byOpened(this.state.projects)[0];
    return last && (await isDir(dirname(last.dir))) ? dirname(last.dir) : os.homedir();
  }

  /** What the sheet starts with for a folder: its name and repos, the images that look like its logo, its repository's page. */
  private async draftFor(dir: string, selfId: string | null): Promise<ProjectDraft> {
    const repos = await discoverRepos(dir);
    // A folder that is itself a repo has nothing to order.
    const self = repos.length === 1 && repos[0]!.path === dir;
    const [found, web] = await Promise.all([findLogos(dir, repos), repos.length === 1 ? remoteWebUrl(repos[0]!.path) : Promise.resolve(null)]);
    const taken = this.state.projects.find((project) => project.dir === dir && project.id !== selfId);
    return {
      dir,
      name: basename(dir) || dir,
      repoCount: repos.length,
      repoNames: self ? [] : repos.map((repo) => repo.name),
      logos: found.map((path) => this.logos.add(join(dir, path), path)),
      links: web ? [web] : [],
      taken: taken ? { id: taken.id, name: taken.name } : null,
    };
  }

  /** New project (⌘O): the folder panel, then either the folder's project opens or the sheet gets its starting values. */
  async newProject(): Promise<ProjectDraft | null> {
    const dir = await this.pickFolder('New project', await this.newProjectPlace());
    if (dir === null) return null;
    if (this.projectFor(dir)) {
      await this.openFolder(dir);
      return null;
    }
    return this.draftFor(dir, null);
  }

  /** Change… in the sheet. */
  async chooseProjectFolder(projectId: unknown): Promise<ProjectDraft | null> {
    const self = projectId === null ? null : this.project(projectId);
    if (projectId !== null && (!self || this.isOpen(self))) return null;
    const dir = await this.pickFolder('Choose the project’s folder', self ? dirname(self.dir) : await this.newProjectPlace());
    return dir === null ? null : this.draftFor(dir, self?.id ?? null);
  }

  /** Edit project…: the images and repos of the project's folder. */
  async projectDraft(projectId: unknown): Promise<ProjectDraft | null> {
    const project = this.project(projectId);
    if (!project) return null;
    if (!(await isDir(project.dir))) return { dir: project.dir, name: project.name, repoCount: project.repoCount, repoNames: [], logos: [], links: [], taken: null };
    return this.draftFor(project.dir, project.id);
  }

  /** Choose… in the sheet: any image the user picks, checked before it is offered. */
  async chooseLogo(): Promise<ChosenLogo> {
    const win = this.getWindow();
    const options = {
      title: 'Choose a logo',
      buttonLabel: 'Choose',
      defaultPath: await this.newProjectPlace(),
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: LOGO_EXTENSIONS }],
    };
    const picked = await (win && !win.isDestroyed() ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    const path = picked.filePaths[0];
    if (picked.canceled || !path) return null;
    const checked = await checkLogo(path);
    return checked.ok ? { ok: true, logo: this.logos.add(checked.real, basename(path)) } : { ok: false, error: checked.error };
  }

  /**
   * The logo the sheet picked, as it is kept: an image is copied into edi's folder first (`copied`, to
   * delete if it ends up unused). `current` is the project's logo now, for `keep`.
   */
  private async logoFrom(
    choice: ProjectInput['logo'],
    projectId: string,
    current: ProjectLogo | null,
  ): Promise<{ ok: true; logo: ProjectLogo; copied: string | null } | { ok: false; error: string }> {
    if (choice.kind === 'letter') return { ok: true, logo: { kind: 'letter', color: choice.color }, copied: null };
    if (choice.kind === 'keep') return current ? { ok: true, logo: current, copied: null } : { ok: false, error: 'Invalid request' };
    const source = this.logos.path(choice.id);
    if (source === null) return { ok: false, error: 'The image is no longer offered; choose it again' };
    const stored = await storeLogo(this.logoFolder, projectId, source);
    return stored.ok ? { ok: true, logo: { kind: 'image', file: stored.file }, copied: stored.file } : stored;
  }

  /** The New project sheet's Create project: the project is made as its folder opens. */
  async createProject(input: unknown): Promise<OpenResult> {
    const clean = cleanInput(input);
    if (!clean.ok) return clean;
    const dir = await realDir(clean.input.dir);
    if (dir === null) return { ok: false, error: 'Folder not found' };
    const taken = this.projectFor(dir);
    if (taken) return takenBy(taken);
    const id = randomUUID();
    const logo = await this.logoFrom(clean.input.logo, id, null);
    if (!logo.ok) return logo;
    const result = await this.openFolder(dir, { id, name: clean.input.name, logo: logo.logo, links: clean.input.links, repos: clean.input.repos });
    // Not opened (cancelled, or another request for the folder came first): the copy isn't anyone's.
    if (logo.copied !== null && !this.project(id)) void dropLogo(this.logoFolder, logo.copied);
    return result;
  }

  /** Edit project…'s Save. The open project keeps its folder. */
  async updateProject(projectId: unknown, input: unknown): Promise<OpenResult> {
    const project = this.project(projectId);
    if (!project) return NO_PROJECT;
    const clean = cleanInput(input);
    if (!clean.ok) return clean;
    let dir = project.dir;
    if (clean.input.dir !== project.dir) {
      if (this.isOpen(project)) return { ok: false, error: 'The open project stays in its folder' };
      const real = await realDir(clean.input.dir);
      if (real === null) return { ok: false, error: 'Folder not found' };
      const taken = this.projectFor(real);
      if (taken && taken.id !== project.id) return takenBy(taken);
      dir = real;
    }
    const logo = await this.logoFrom(clean.input.logo, project.id, project.logo);
    if (!logo.ok) return logo;
    if (!this.project(project.id)) {
      // Removed while the image was copied.
      if (logo.copied !== null) void dropLogo(this.logoFolder, logo.copied);
      return NO_PROJECT;
    }
    const { name, links, repos } = clean.input;
    this.changeProjects((projects) => projects.map((other) => (other.id === project.id ? { ...other, dir, name, logo: logo.logo, links, repos } : other)));
    // The open project lists its repos again at once; its card and menu count the ones kept. In turn with
    // opening folders: an open in flight finishes first, and the settings are read afresh once it has.
    if (JSON.stringify(repos) !== JSON.stringify(project.repos)) {
      await this.opening.run(`\0repos:${project.id}`, async () => {
        const current = this.project(project.id);
        if (!current || !this.isOpen(current)) return { ok: true };
        const repoCount = await this.workspace.setRepoSettings(current.repos);
        if (repoCount !== null) this.changeProjects((projects) => projects.map((other) => (other.id === current.id ? { ...other, repoCount } : other)));
        return { ok: true };
      });
    }
    const old = project.logo;
    if (old.kind === 'image' && (logo.logo.kind !== 'image' || logo.logo.file !== old.file)) void dropLogo(this.logoFolder, old.file);
    return { ok: true };
  }

  /** Remove from list: after asking. The open project closes first (asking too if a terminal is busy). */
  async removeProject(projectId: unknown): Promise<OpenResult> {
    const project = this.project(projectId);
    if (!project) return NO_PROJECT;
    if (!(await this.ask(removeProjectQuestion(project.name)))) return CANCELLED;
    if (this.isOpen(project)) {
      if (!(await this.confirmBusy('close'))) return CANCELLED;
      await this.closeFolder();
    }
    this.changeProjects((projects) => projects.filter((other) => other.id !== project.id));
    if (project.logo.kind === 'image') void dropLogo(this.logoFolder, project.logo.file);
    return { ok: true };
  }

  async openProject(projectId: unknown): Promise<OpenResult> {
    const project = this.project(projectId);
    if (!project) return NO_PROJECT;
    if (!(await isDir(project.dir))) {
      void this.sendProjects();
      return { ok: false, error: 'Folder not found' };
    }
    return this.openFolder(project.dir);
  }

  /** Locate…: for a project whose folder has moved, the folder panel to find it. */
  async locateProject(projectId: unknown): Promise<OpenResult> {
    const project = this.project(projectId);
    if (!project) return NO_PROJECT;
    if (this.isOpen(project)) return { ok: false, error: 'The open project stays in its folder' };
    const parent = dirname(project.dir);
    const dir = await this.pickFolder(`Locate ${project.name}`, (await isDir(parent)) ? parent : os.homedir());
    if (dir === null) return CANCELLED;
    const taken = this.projectFor(dir);
    if (taken && taken.id !== project.id) return takenBy(taken);
    this.changeProjects((projects) => projects.map((other) => (other.id === project.id ? { ...other, dir } : other)));
    return { ok: true };
  }

  async revealProject(projectId: unknown): Promise<void> {
    const project = this.project(projectId);
    if (project && (await isDir(project.dir))) shell.showItemInFolder(project.dir);
  }

  /** The right-click menu of a project card. */
  async projectMenu(projectId: unknown): Promise<ProjectMenuAction | null> {
    const project = this.project(projectId);
    if (!project) return null;
    const exists = await isDir(project.dir);
    const items: { id: ProjectMenuAction | null; label: string; enabled?: boolean }[] = [{ id: 'open', label: 'Open', enabled: exists }];
    if (project.links.length > 0) {
      items.push({ id: null, label: '-' });
      project.links.forEach((link, index) => items.push({ id: `link:${index}`, label: `Open ${linkName(link)}` }));
    }
    items.push(
      { id: null, label: '-' },
      { id: 'edit', label: 'Edit Project…' },
      { id: 'reveal', label: 'Reveal in Finder', enabled: exists },
      { id: null, label: '-' },
      { id: 'remove', label: 'Remove from List…' },
    );
    return this.popup(items);
  }

  register(): void {
    // Images and videos in the file view: only from inside discovered repos.
    protocol.handle(MEDIA_SCHEME, (request) =>
      serveMedia((repoPath) => this.workspace.repo(repoPath)?.path ?? null, request.url, request.headers.get('range')),
    );
    // Logos: edi's own copies, and the images offered in the sheet.
    protocol.handle(LOGO_SCHEME, (request) => serveLogo(this.logoFolder, this.logos, request.url));
    ipcMain.handle('state:get', () => this.appState());
    // A project is named by its id; only the main process turns it into a folder.
    ipcMain.handle('project:new', () => this.newProject());
    ipcMain.handle('project:chooseFolder', (_event, projectId: unknown) => this.chooseProjectFolder(projectId));
    ipcMain.handle('project:sheet', (_event, projectId: unknown) => this.projectDraft(projectId));
    ipcMain.handle('project:chooseLogo', () => this.chooseLogo());
    ipcMain.handle('project:create', (_event, input: unknown) => this.createProject(input));
    ipcMain.handle('project:update', (_event, projectId: unknown, input: unknown) => this.updateProject(projectId, input));
    ipcMain.handle('project:remove', (_event, projectId: unknown) => this.removeProject(projectId));
    ipcMain.handle('project:open', (_event, projectId: unknown) => this.openProject(projectId));
    ipcMain.handle('project:locate', (_event, projectId: unknown) => this.locateProject(projectId));
    ipcMain.handle('project:reveal', (_event, projectId: unknown) => this.revealProject(projectId));
    ipcMain.handle('project:menu', (_event, projectId: unknown) => this.projectMenu(projectId));
    ipcMain.handle('workspace:rescan', () => this.workspace.rescan());
    ipcMain.on('layout:set', (_event, patch: unknown) => this.setLayout(patch));

    // The repo path and operation are validated in GitOps; nothing free-form reaches git from here.
    ipcMain.handle('git:run', (_event, repoPath: unknown, op: unknown) => this.gitOps.run(repoPath as string, op as GitOp));
    ipcMain.handle('git:fetchAll', () => this.gitOps.fetchAll());
    ipcMain.handle('git:branches', (_event, repoPath: unknown) => this.gitOps.branches(repoPath as string));
    ipcMain.handle('git:unpushed', (_event, repoPath: unknown) => this.gitOps.unpushed(repoPath));
    ipcMain.handle('git:incoming', (_event, repoPath: unknown) => this.gitOps.incoming(repoPath));
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
    ipcMain.handle('git:fileMenu', (_event, state: unknown) => {
      const valid = gitFileMenuState(state);
      return valid ? this.popup(gitFileMenuItems(valid)) : null;
    });
    ipcMain.handle('git:confirmDropStash', (_event, label: unknown) => this.ask(dropStashQuestion(typeof label === 'string' ? label : 'this stash')));
    // Read-only view operations: paths are validated in ViewOps.
    ipcMain.handle('view:diff', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.diff(repoPath, filePath));
    ipcMain.on('edits:unsaved', (_event, count: unknown) => {
      this.unsavedFiles = typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0;
    });
    ipcMain.handle('git:confirmUndo', (_event, subject: unknown) => this.ask(undoCommitQuestion(typeof subject === 'string' ? subject : 'this commit')));
    ipcMain.handle('git:confirmDiscardChanges', (_event, target: unknown) => {
      const valid = discardTarget(target);
      return valid ? this.ask(discardChangesQuestion(valid)) : false;
    });
    ipcMain.handle('git:confirmRevert', (_event, subject: unknown) => this.ask(revertCommitQuestion(typeof subject === 'string' ? subject : 'this commit')));
    ipcMain.handle('edits:confirmDiscard', (_event, name: unknown) => this.ask(discardQuestion(typeof name === 'string' ? name : 'this file')));
    ipcMain.handle('view:read', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.readFile(repoPath, filePath));
    ipcMain.handle('view:mediaSize', (_event, repoPath: unknown, filePath: unknown, rev: unknown) => this.viewOps.mediaSize(repoPath, filePath, rev));
    ipcMain.handle('files:create', (_event, repoPath: unknown, path: unknown, kind: unknown) => this.fileOps.create(repoPath, path, kind));
    ipcMain.handle('files:rename', (_event, repoPath: unknown, path: unknown, name: unknown, unsaved: unknown) =>
      this.fileOps.rename(repoPath, path, name, unsaved),
    );
    ipcMain.handle('files:trash', (_event, repoPath: unknown, path: unknown, unsaved: unknown) => this.fileOps.trash(repoPath, path, unsaved));
    ipcMain.handle('files:reveal', (_event, repoPath: unknown, path: unknown) => this.fileOps.reveal(repoPath, path));
    ipcMain.handle('files:copy', (_event, repoPath: unknown, path: unknown) => this.fileOps.copy(repoPath, path));
    ipcMain.handle('files:paste', (_event, repoPath: unknown, dir: unknown) => this.fileOps.paste(repoPath, dir));
    ipcMain.handle('files:duplicate', (_event, repoPath: unknown, path: unknown) => this.fileOps.duplicate(repoPath, path));
    ipcMain.handle('files:menu', (_event, kind: unknown) => this.fileOps.menu(kind));
    ipcMain.handle('files:saveNew', (_event, text: unknown, repoPath: unknown) => this.fileOps.saveNew(text, repoPath));
    ipcMain.handle('view:headText', (_event, repoPath: unknown, filePath: unknown) => this.viewOps.headText(repoPath, filePath));
    ipcMain.handle('view:blame', (_event, repoPath: unknown, filePath: unknown, text: unknown) => this.viewOps.blame(repoPath, filePath, text));
    ipcMain.handle('view:write', (_event, repoPath: unknown, filePath: unknown, text: unknown, expected: unknown) =>
      this.viewOps.writeFile(repoPath, filePath, text, expected),
    );
    ipcMain.handle('view:list', (_event, repoPath: unknown) => this.viewOps.listFiles(repoPath));
    ipcMain.handle('search:run', (_event, repoPath: unknown, query: unknown, id: unknown) => this.searchOps.search(repoPath, query, id));
    ipcMain.on('search:stop', (_event, id: unknown) => this.searchOps.stop(id));
    ipcMain.handle('search:replace', (_event, repoPath: unknown, path: unknown, query: unknown, replacement: unknown, stamp: unknown, lines: unknown) =>
      this.searchOps.replace(repoPath, path, query, replacement, stamp, lines),
    );
    ipcMain.handle('search:confirmReplaceAll', (_event, summary: unknown) => {
      const question = replaceAllQuestion(summary);
      return question ? this.ask(question) : false;
    });
    ipcMain.handle('view:listDir', (_event, repoPath: unknown, dirPath: unknown) => this.viewOps.listDir(repoPath, dirPath));
    ipcMain.handle('view:openIn', (_event, editor: unknown, repoPath: unknown, filePath: unknown) => this.viewOps.openIn(editor, repoPath, filePath));
    ipcMain.handle('shell:openUrl', (_event, url: unknown) => openUrl(url));
    ipcMain.handle('history:log', (_event, repoPath: unknown, count: unknown) => this.historyOps.log(repoPath, count));
    ipcMain.handle('history:commit', (_event, repoPath: unknown, oid: unknown) => this.historyOps.commit(repoPath, oid));
    ipcMain.handle('history:file', (_event, repoPath: unknown, path: unknown, count: unknown) => this.historyOps.fileHistory(repoPath, path, count));
    ipcMain.handle('history:fileChange', (_event, repoPath: unknown, oid: unknown, path: unknown, origPath: unknown) =>
      this.historyOps.fileChange(repoPath, oid, path, origPath),
    );
    ipcMain.handle('history:commitMenu', (_event, repoPath: unknown, oid: unknown, opts: unknown) => this.historyOps.commitMenu(repoPath, oid, opts));

    ipcMain.handle('pty:create', async (_event, o: unknown): Promise<TerminalCreated> => {
      const opts = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
      const dir = this.workspace.view().dir;
      if (dir === null) throw new Error('No folder is open');
      // The path from the page isn't free: only a discovered repo or the open folder, or a folder inside the repo.
      const repo = typeof opts.repoPath === 'string' ? this.workspace.repo(opts.repoPath) : null;
      if (typeof opts.repoPath === 'string' && !repo) throw new Error('Unknown repository');
      let cwd = repo?.path ?? dir;
      if (repo && typeof opts.dir === 'string' && opts.dir !== '') {
        const folder = await locateInRepo(repo.path, opts.dir);
        if (!folder.ok || !(await isDir(folder.target))) throw new Error('Folder not found');
        cwd = folder.target;
      }
      const id = this.ptys.create({
        cols: Number(opts.cols),
        rows: Number(opts.rows),
        cwd,
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
      if (typeof id !== 'number') return;
      this.ptys.kill(id);
      this.terminalGone(id);
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
    this.keepAwake.dispose();
    this.workspace.dispose();
    this.ptys.killAll();
  }

  /** Reads the process list once and derives both the tab states and the Claude Code sessions from it. */
  private async pollProcesses(): Promise<void> {
    if (this.pollingProcesses || this.workspace.view().dir === null) return;
    this.pollingProcesses = true;
    const started = this.terminalsChanged;
    try {
      const [ps, pids] = await Promise.all([listPs(), listClaudePids()]);
      const ptys = this.ptyInfos();
      // Localhost ports opened for listening in the terminals, and the Claude Code sessions.
      const [servers, sessions] = await Promise.all([listServers(ptys, ps), listClaudeSessions(ps, pids)]);
      // A terminal closed or the folder switched meanwhile: the old terminals' servers would come back.
      if (started !== this.terminalsChanged) return;

      const tabs = tabStates(ptys, ps, new Set(pids));
      this.busyTabs = tabs.filter((tab) => tab.busy).length;
      // Sent only on change, so the page isn't needlessly redrawn every three seconds.
      const serialized = JSON.stringify(tabs);
      if (serialized !== this.tabsSent) {
        this.tabsSent = serialized;
        this.send('tabs', tabs);
      }
      this.sendServers(servers);
      this.workspace.setSessionCwds(sessions.map((session) => session.cwd));
    } finally {
      this.pollingProcesses = false;
      if (started !== this.terminalsChanged) void this.pollProcesses();
    }
  }
}
