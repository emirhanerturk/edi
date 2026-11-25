import type { RepoView } from '../shared/api.js';

/** A repo is fetched again this long after its last automatic fetch, as VS Code does. */
export const AUTO_FETCH_MS = 180_000;
/** Coming back to the window fetches the repos not fetched for this long. */
export const FOCUS_FETCH_MS = 60_000;
/** How often the due repos are looked for. */
const TICK_MS = 30_000;

export interface AutoFetchDeps {
  /** The open folder's repos. */
  repos(): RepoView[];
  /** Fetches one repo quietly; false when it was skipped (busy, no remote, failing). */
  fetch(repoPath: string): Promise<boolean>;
  /** False while the computer is offline: nothing is tried then. */
  isOnline(): boolean;
  now?(): number;
}

/**
 * Keeps the remote branches fresh so the Pull count shows a teammate's push without a click: every repo
 * with a remote is fetched every few minutes, and on coming back to the window. One repo at a time.
 */
export class AutoFetch {
  private timer: NodeJS.Timeout | null = null;
  /** When each repo was last fetched automatically. */
  private readonly last = new Map<string, number>();
  private fetching = false;
  private readonly now: () => number;

  constructor(
    private readonly deps: AutoFetchDeps,
    private enabled: boolean,
  ) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Turned back on, the repos not fetched for a while are fetched right away. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) void this.tick();
  }

  /** The window came to the front. */
  focus(): Promise<void> {
    return this.tick(FOCUS_FETCH_MS);
  }

  /** Fetches, one after another, the repos whose last automatic fetch is at least `age` old (never fetched: at once). */
  async tick(age = AUTO_FETCH_MS): Promise<void> {
    if (!this.enabled || this.fetching || !this.deps.isOnline()) return;
    this.fetching = true;
    try {
      for (const repo of this.deps.repos()) {
        if (!this.enabled) break;
        if (!repo.hasRemote) continue;
        const last = this.last.get(repo.path);
        if (last !== undefined && this.now() - last < age) continue;
        if (await this.deps.fetch(repo.path).catch(() => false)) this.last.set(repo.path, this.now());
      }
    } finally {
      this.fetching = false;
    }
  }
}
