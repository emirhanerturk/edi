import { realpath, stat } from 'node:fs/promises';
import { type Repo, discoverRepos } from '../git/discover.js';
import { runGit } from '../git/exec.js';
import { getStatus } from '../git/status.js';
import { assignSessions } from '../sessions.js';
import type { RepoView, WorkspaceView } from '../shared/api.js';

/** How many status polls between rereads of the remote list. */
const REMOTES_EVERY = 15;

export type OpenWorkspaceResult = { ok: true; repoCount: number } | { ok: false; error: string };

/**
 * Live state of the open folder and its repos. Polls the status at a fixed interval; no file watching
 * (expensive and fragile in `node_modules` folders with hundreds of thousands of files).
 */
export class Workspace {
  private dir: string | null = null;
  private repos: RepoView[] = [];
  private rootSessions = 0;
  private sessionCwds: string[] = [];
  private refreshedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Repos whose status is being read right now: a slow repo doesn't pile up overlapping polls. */
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /** Incremented when the folder changes; late results from the old folder are ignored. */
  private generation = 0;
  private readonly onChange: (view: WorkspaceView) => void;
  private readonly statusMs: number;
  private rounds = 0;

  constructor(opts: { onChange: (view: WorkspaceView) => void; statusMs?: number }) {
    this.onChange = opts.onChange;
    this.statusMs = opts.statusMs ?? 2000;
  }

  async open(dir: string): Promise<OpenWorkspaceResult> {
    let real: string;
    try {
      real = await realpath(dir);
      if (!(await stat(real)).isDirectory()) return { ok: false, error: 'Not a folder' };
    } catch {
      return { ok: false, error: 'Folder not found' };
    }

    this.stop();
    this.generation++;
    this.dir = real;
    this.repos = (await discoverRepos(real)).map(emptyView);
    this.applySessions();
    await Promise.all([this.refreshRemotes(), this.refreshAll()]);
    this.timer = setInterval(() => void this.refreshAll(), this.statusMs);
    return { ok: true, repoCount: this.repos.length };
  }

  /** Rescans the folder: new repos are added, vanished ones dropped, and the rest keep their state. */
  async rescan(): Promise<void> {
    if (this.dir === null) return;
    const generation = this.generation;
    const found = await discoverRepos(this.dir);
    if (generation !== this.generation) return;
    const known = new Map(this.repos.map((repo) => [repo.path, repo]));
    this.repos = found.map((repo) => known.get(repo.path) ?? emptyView(repo));
    this.applySessions();
    await Promise.all([this.refreshRemotes(), this.refreshAll()]);
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

  dispose(): void {
    this.stop();
    this.generation++;
    this.dir = null;
    this.repos = [];
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.inFlight.clear();
  }

  private emit(): void {
    this.onChange(this.view());
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
    await Promise.all(this.repos.map((repo) => this.refreshOne(repo.path)));
    if (generation !== this.generation) return;
    this.refreshedAt = Date.now();
    this.emit();
  }

  /** True if the status was read; false if the folder changed in the meantime. A read in progress shares its result. */
  private refreshOne(path: string): Promise<boolean> {
    const running = this.inFlight.get(path);
    if (running) return running;
    const generation = this.generation;
    const reading: Promise<boolean> = getStatus(path)
      .then((result) => {
        if (generation !== this.generation) return false;
        this.patch(path, result.ok ? { status: result.status, error: null } : { status: null, error: result.error });
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
