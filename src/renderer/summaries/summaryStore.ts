// Claude summaries the user asked for, by place: running, done or failed. Kept for the session; a place's summary
// stays until it is closed or asked for again.
import { create } from 'zustand';
import type { RepoView, SummaryRequest, SummaryResult } from '../../shared/api';
import { edi } from '../bridge';
import { useApp } from '../store';

export interface SummaryRun {
  /** Names the run for cancelling it. */
  id: number;
  request: SummaryRequest;
  /** What it says while it runs: "Claude Code is reading 4 commits…". */
  reading: string;
  /** Null while it runs. */
  result: SummaryResult | null;
}

/** Where a summary belongs: one per place. */
export const summaryKey = {
  incoming: (repoPath: string) => `incoming\n${repoPath}`,
  changes: (repoPath: string) => `changes\n${repoPath}`,
  message: (repoPath: string) => `message\n${repoPath}`,
  pullRequest: (repoPath: string) => `pullRequest\n${repoPath}`,
  stash: (repoPath: string, oid: string) => `stash\n${repoPath}\n${oid}`,
  commit: (repoPath: string, oid: string) => `commit\n${repoPath}\n${oid}`,
  /** A day in History, in the open folder, with the repository filter it was asked under. */
  day: (dir: string, filter: string | null, label: string) => `day\n${dir}\n${filter ?? ''}\n${label}`,
};

interface SummaryStore {
  runs: Record<string, SummaryRun>;
  /**
   * Runs Claude Code for `key`, stopping a run already going there. Resolves with the result, or null if the
   * place was closed or asked again meanwhile. A cancelled run leaves nothing behind.
   */
  start(key: string, request: SummaryRequest, reading: string): Promise<SummaryResult | null>;
  /** Stops a run and closes what the place showed. */
  close(key: string): void;
}

let nextId = 1;

const without = (runs: Record<string, SummaryRun>, key: string) => {
  const next = { ...runs };
  delete next[key];
  return next;
};

export const useSummaries = create<SummaryStore>((set, get) => ({
  runs: {},
  async start(key, request, reading) {
    const previous = get().runs[key];
    if (previous && previous.result === null) edi.cancelSummary(previous.id);
    const id = nextId++;
    set((state) => ({ runs: { ...state.runs, [key]: { id, request, reading, result: null } } }));
    let result: SummaryResult;
    try {
      result = await edi.summarize(id, request);
    } catch (err) {
      result = { ok: false, reason: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
    const current = get().runs[key];
    if (current?.id !== id) return null;
    set((state) => ({ runs: !result.ok && result.reason === 'cancelled' ? without(state.runs, key) : { ...state.runs, [key]: { ...current, result } } }));
    return result;
  },
  close(key) {
    const run = get().runs[key];
    if (!run) return;
    if (run.result === null) edi.cancelSummary(run.id);
    set((state) => ({ runs: without(state.runs, key) }));
  },
}));

/** The run at `key`, if any. */
export const useSummary = (key: string): SummaryRun | undefined => useSummaries((state) => state.runs[key]);

/** What a run's sparkle shows: muted, Claude's colour while it runs, and while its result is open. */
export function sparkState(run: SummaryRun | undefined): 'idle' | 'running' | 'on' {
  if (!run) return 'idle';
  return run.result === null ? 'running' : 'on';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Claude Code is reading 4 commits…" */
export const readingText = (what: string) => `Claude Code is reading ${what}…`;
export const readingCommits = (n: number) => readingText(plural(n, 'commit'));
export const readingFiles = (n: number) => readingText(plural(n, 'changed file'));

type RepoState = Pick<RepoView, 'path' | 'status'>;

/**
 * The summaries that no longer describe their repo: what a pull brings once it was pulled or more was fetched,
 * the changes once they were committed, a pull request's draft once its commits were pushed or more were made,
 * and all three when the branch changed.
 */
export function staleKeys(prev: RepoState[], next: RepoState[]): string[] {
  const before = new Map(prev.map((repo) => [repo.path, repo.status]));
  const keys: string[] = [];
  for (const repo of next) {
    const was = before.get(repo.path);
    const now = repo.status;
    if (!was || !now) continue;
    const moved = was.head !== now.head;
    if (moved || was.upstream !== now.upstream || was.behind !== now.behind) keys.push(summaryKey.incoming(repo.path));
    if (moved || now.files.length === 0) keys.push(summaryKey.changes(repo.path));
    if (moved || was.ahead !== now.ahead) keys.push(summaryKey.pullRequest(repo.path));
  }
  return keys;
}

// Another folder: every summary goes. The same folder: the ones that no longer hold go.
useApp.subscribe((state, prev) => {
  if (state.workspace === prev.workspace) return;
  const { runs, close } = useSummaries.getState();
  const keys = state.workspace.dir !== prev.workspace.dir ? Object.keys(runs) : staleKeys(prev.workspace.repos, state.workspace.repos);
  for (const key of keys) if (runs[key]) close(key);
});
