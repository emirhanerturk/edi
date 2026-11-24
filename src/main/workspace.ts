import { realpath, stat } from 'node:fs/promises';
import { type Repo, discoverRepos } from '../git/discover.js';
import { getStatus } from '../git/status.js';
import { assignSessions } from '../sessions.js';
import type { RepoView, WorkspaceView } from '../shared/api.js';

export type OpenWorkspaceResult = { ok: true; repoCount: number } | { ok: false; error: string };

/**
 * Açık klasör ve içindeki repoların canlı durumu. Durumu belirli aralıkla yoklar; dosya izleme yok
 * (yüz binlerce dosyalı `node_modules` klasörlerinde pahalı ve kırılgan).
 */
export class Workspace {
  private dir: string | null = null;
  private repos: RepoView[] = [];
  private rootSessions = 0;
  private sessionCwds: string[] = [];
  private refreshedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  /** O an durumu okunan repolar: yavaş bir repo, üst üste binen yoklamalar biriktirmez. */
  private readonly inFlight = new Set<string>();
  /** Klasör değişince artar; eski klasörden geç gelen sonuçlar yok sayılır. */
  private generation = 0;
  private readonly onChange: (view: WorkspaceView) => void;
  private readonly statusMs: number;

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
    await this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), this.statusMs);
    return { ok: true, repoCount: this.repos.length };
  }

  /** Klasörü yeniden tarar: yeni repolar eklenir, kaybolanlar düşer, kalanların durumu korunur. */
  async rescan(): Promise<void> {
    if (this.dir === null) return;
    const generation = this.generation;
    const found = await discoverRepos(this.dir);
    if (generation !== this.generation) return;
    const known = new Map(this.repos.map((repo) => [repo.path, repo]));
    this.repos = found.map((repo) => known.get(repo.path) ?? emptyView(repo));
    this.applySessions();
    await this.refreshAll();
  }

  view(): WorkspaceView {
    return { dir: this.dir, repos: this.repos, rootSessions: this.rootSessions, refreshedAt: this.refreshedAt };
  }

  /** Yalnız keşfedilmiş bir reponun tam yolu eşleşir: sayfadan gelen yol bununla doğrulanır. */
  repo(path: string): RepoView | null {
    return this.repos.find((repo) => repo.path === path) ?? null;
  }

  async refresh(path: string): Promise<void> {
    if (await this.refreshOne(path)) this.emit();
  }

  setBusy(path: string, label: string | null): void {
    if (!this.repo(path)) return;
    this.patch(path, { busy: label });
    this.emit();
  }

  /** Terminalde açık Claude Code oturumlarının çalışma dizinleri. */
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

  private async refreshAll(): Promise<void> {
    const generation = this.generation;
    await Promise.all(this.repos.map((repo) => this.refreshOne(repo.path)));
    if (generation !== this.generation) return;
    this.refreshedAt = Date.now();
    this.emit();
  }

  /** Durum okunduysa true; repo zaten okunuyorsa ya da klasör bu arada değiştiyse false. */
  private async refreshOne(path: string): Promise<boolean> {
    if (this.inFlight.has(path)) return false;
    const generation = this.generation;
    this.inFlight.add(path);
    try {
      const result = await getStatus(path);
      if (generation !== this.generation) return false;
      this.patch(path, result.ok ? { status: result.status, error: null } : { status: null, error: result.error });
      return true;
    } finally {
      if (generation === this.generation) this.inFlight.delete(path);
    }
  }
}

function emptyView(repo: Repo): RepoView {
  return { name: repo.name, path: repo.path, status: null, error: null, busy: null, claude: 0 };
}
