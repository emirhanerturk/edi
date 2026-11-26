import { realpath, stat } from 'node:fs/promises';
import { type Repo, discoverRepos } from '../git/discover.js';
import { runGit } from '../git/exec.js';
import { operationIn } from '../git/operation.js';
import { type GitDirs, gitDirs, refsStamp } from '../git/refsStamp.js';
import { getStatus } from '../git/status.js';
import { assignSessions } from '../sessions.js';
import type { RepoOperation, RepoSettings, RepoView, WorkspaceView } from '../shared/api.js';
import { NO_REPO_SETTINGS, arrangeRepos } from '../shared/projects.js';

/** How many status polls between rereads of the remote list. */
const REMOTES_EVERY = 15;
/** Statuses that arrive within this long of each other reach the page in one update. */
const EMIT_BATCH_MS = 30;

export type OpenWorkspaceResult = { ok: true; repoCount: number } | { ok: false; error: string };

/**
 * Live state of the open folder and its repos. Polls the status at a fixed interval; no file watching
 * (expensive and fragile in `node_modules` folders with hundreds of thousands of files).
 */
export class Workspace {
  private dir: string | null = null;
  private repos: RepoView[] = [];
  /** The open project's repo order and ignored repos. */
  private repoSettings: RepoSettings = NO_REPO_SETTINGS;
  private rootSessions = 0;
  private sessionCwds: string[] = [];
  private refreshedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Repos whose status is being read right now: a slow repo doesn't pile up overlapping polls. */
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /** Each repo's git folders, looked up once (a promise, so polls in a row share the lookup). */
  private readonly gitDirs = new Map<string, Promise<GitDirs | null>>();
  /** Incremented when the folder changes; late results from the old folder are ignored. */
  private generation = 0;
  private readonly onChange: (view: WorkspaceView) => void;
  private readonly statusMs: number;
  private rounds = 0;
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(opts: { onChange: (view: WorkspaceView) => void; statusMs?: number }) {
    this.onChange = opts.onChange;
    this.statusMs = opts.statusMs ?? 2000;
  }

  /** Opens a folder; its repos are listed as `repos` says (the project's order, without its ignored repos). */
  async open(dir: string, repos: RepoSettings = NO_REPO_SETTINGS): Promise<OpenWorkspaceResult> {
    let real: string;
    try {
      real = await realpath(dir);
      if (!(await stat(real)).isDirectory()) return { ok: false, error: 'Not a folder' };
    } catch {
      return { ok: false, error: 'Folder not found' };
    }

    this.stop();
    const generation = ++this.generation;
    this.dir = real;
    this.repoSettings = repos;
    const found = await this.find(real);
    // Another folder was opened, or the workspace closed, meanwhile: this one is no longer wanted.
    if (generation !== this.generation) return { ok: false, error: 'Another folder was opened' };
    this.repos = found.map(emptyView);
    this.applySessions();
    await Promise.all([this.refreshRemotes(), this.refreshAll()]);
    if (generation !== this.generation) return { ok: false, error: 'Another folder was opened' };
    this.timer = setInterval(() => void this.refreshAll(), this.statusMs);
    return { ok: true, repoCount: this.repos.length };
  }

  /** Rescans the folder: new repos are added, vanished ones dropped, and the rest keep their state. */
  async rescan(): Promise<void> {
    if (this.dir === null) return;
    const generation = this.generation;
    const found = await this.find(this.dir);
    if (generation !== this.generation) return;
    const known = new Map(this.repos.map((repo) => [repo.path, repo]));
    this.repos = found.map((repo) => known.get(repo.path) ?? emptyView(repo));
    this.applySessions();
    await Promise.all([this.refreshRemotes(), this.refreshAll()]);
  }

  /** New settings for the open project: its repos are listed again with them, keeping the state of those that stay. */
  async setRepoSettings(repos: RepoSettings): Promise<void> {
    this.repoSettings = repos;
    await this.rescan();
    this.emit();
  }

  /** The repos in `dir` as the settings list them. A folder that is itself a repo is shown as is: there is nothing to order. */
  private async find(dir: string): Promise<Repo[]> {
    const found = await discoverRepos(dir);
    return found.length === 1 && found[0]!.path === dir ? found : arrangeRepos(found, this.repoSettings);
  }

  view(): WorkspaceView {
    return { dir: this.dir, repos: this.repos, rootSessions: this.rootSessions, refreshedAt: this.refreshedAt };
  }

  /** Only the exact path of a discovered repo matches: paths from the page are validated with this. */
  repo(path: string): RepoView | null {
    return this.repos.find((repo) => repo.path === path) ?? null;
  }

  /** Rereads the status now. Waits for any read in progress first: it may have seen the state from before this call. */
  async refresh(path: string): Promise<void> {
    await this.inFlight.get(path);
    if (await this.refreshOne(path)) this.emit();
  }

  setBusy(path: string, label: string | null): void {
    if (!this.repo(path)) return;
    this.patch(path, { busy: label });
    this.emit();
  }

  /** Working directories of the Claude Code sessions open in a terminal. */
  setSessionCwds(cwds: string[]): void {
    this.sessionCwds = cwds;
    const before = JSON.stringify([this.rootSessions, this.repos.map((repo) => repo.claude)]);
    this.applySessions();
    if (before !== JSON.stringify([this.rootSessions, this.repos.map((repo) => repo.claude)])) this.emit();
  }

  /** No folder is open any more; late results from the one that was are ignored. */
  close(): void {
    this.stop();
    this.generation++;
    this.dir = null;
    this.repos = [];
    this.rootSessions = 0;
  }

  dispose(): void {
    this.close();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.inFlight.clear();
  }

  private emit(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.onChange(this.view());
  }

  /** An update shortly: the statuses of other repos arriving meanwhile go along with it. */
  private emitSoon(): void {
    this.emitTimer ??= setTimeout(() => this.emit(), EMIT_BATCH_MS);
  }

  private patch(path: string, change: Partial<RepoView>): void {
    this.repos = this.repos.map((repo) => (repo.path === path ? { ...repo, ...change } : repo));
  }

  private applySessions(): void {
    if (this.dir === null) return;
    const assigned = assignSessions(this.sessionCwds, this.dir, this.repos);
    this.rootSessions = assigned.root;
    this.repos = this.repos.map((repo) => {
      const claude = assigned.byRepo[repo.path] ?? 0;
      return repo.claude === claude ? repo : { ...repo, claude };
    });
  }

  /** The remote list rarely changes: it is read on open, on rescan and now and then. */
  private async refreshRemotes(): Promise<void> {
    const generation = this.generation;
    const results = await Promise.all(
      this.repos.map(async (repo) => {
        const result = await runGit(repo.path, ['remote']);
        return { path: repo.path, hasRemote: result.ok ? result.stdout.trim() !== '' : null };
      }),
    );
    if (generation !== this.generation) return;
    for (const { path, hasRemote } of results) {
      if (hasRemote !== null && this.repo(path)?.hasRemote !== hasRemote) this.patch(path, { hasRemote });
    }
  }

  private async refreshAll(): Promise<void> {
    const generation = this.generation;
    // A remote added from the terminal is noticed within about half a minute.
    if (++this.rounds % REMOTES_EVERY === 0) void this.refreshRemotes();
    // Each repo's status reaches the page as it arrives: a slow repo doesn't hold up the others.
    await Promise.all(this.repos.map((repo) => this.refreshOne(repo.path).then((read) => read && this.emitSoon())));
    if (generation !== this.generation) return;
    this.refreshedAt = Date.now();
    this.emit();
  }

  /**
   * Read from the repo's git folder: when its tags and remote branches last changed, and the operation
   * it is in the middle of. 0 and null if the folder can't be found.
   */
  private async gitDirState(path: string): Promise<{ refs: number; operation: RepoOperation | null }> {
    let lookup = this.gitDirs.get(path);
    if (!lookup) {
      lookup = gitDirs(path);
      this.gitDirs.set(path, lookup);
    }
    const dirs = await lookup;
    // Not found (the repo is broken right now): looked up again next time.
    if (dirs === null) {
      if (this.gitDirs.get(path) === lookup) this.gitDirs.delete(path);
      return { refs: 0, operation: null };
    }
    const [refs, operation] = await Promise.all([refsStamp(dirs.common), operationIn(dirs.git)]);
    return { refs, operation };
  }

  /** True if the status was read; false if the folder changed in the meantime. A read in progress shares its result. */
  private refreshOne(path: string): Promise<boolean> {
    const running = this.inFlight.get(path);
    if (running) return running;
    const generation = this.generation;
    const reading: Promise<boolean> = Promise.all([getStatus(path), this.gitDirState(path)])
      .then(([result, dirState]) => {
        if (generation !== this.generation) return false;
        this.patch(path, result.ok ? { status: result.status, error: null, ...dirState } : { status: null, error: result.error, ...dirState });
        return true;
      })
      .finally(() => {
        if (this.inFlight.get(path) === reading) this.inFlight.delete(path);
      });
    this.inFlight.set(path, reading);
    return reading;
  }
}

function emptyView(repo: Repo): RepoView {
  return { name: repo.name, path: repo.path, status: null, error: null, busy: null, claude: 0, hasRemote: false };
}
