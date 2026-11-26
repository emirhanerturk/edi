import { stashMessage } from '../git/stash.js';
import { runGit } from '../git/exec.js';
import {
  type Material,
  type PullRequestMaterial,
  block,
  changesMaterial,
  commitMaterial,
  dayMaterial,
  hasStaged,
  incomingMaterial,
  pullRequestMaterial,
  recentSubjects,
  stashMaterial,
} from '../git/summaryData.js';
import type { ClaudeUsage, SummaryRequest, SummaryResult } from '../shared/api.js';
import { type ClaudeOutcome, type ClaudeRunOptions, askClaude } from './claudeRun.js';
import { cleanLine, cleanMessage, promptFor, splitPullRequest, unfence } from './summaryPrompts.js';
import type { Workspace } from './workspace.js';

/** A stash id: a full commit id. */
const STASH_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** A commit the page shows: short or full lowercase hex. */
const OID = /^[0-9a-f]{7,64}$/;
/** A full commit id, as History lists them. */
const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** A day sums up at most this many repositories and commits. */
const MAX_DAY_REPOS = 50;
const MAX_DAY_COMMITS = 200;

const INVALID: SummaryResult = { ok: false, reason: 'failed', error: 'Invalid request' };
const UNKNOWN_REPO: SummaryResult = { ok: false, reason: 'failed', error: 'Unknown repository' };
const CANCELLED: SummaryResult = { ok: false, reason: 'cancelled', error: 'Cancelled' };

export interface SummaryDeps {
  /** Runs Claude Code; `askClaude` in the app. */
  ask?(opts: ClaudeRunOptions): Promise<ClaudeOutcome>;
  /** The usage limits, for when a limit resets. */
  usage?(): Promise<ClaudeUsage | null>;
  now?(): number;
}

type SummaryDone = Extract<SummaryResult, { ok: true }>;

const isId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
const isStrings = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string');

/** When the limit Claude Code reached resets: the window over 100% in the usage file, else what the message said. */
export function limitInfo(usage: ClaudeUsage | null, fromMessage: number | null): { error: string; resetsAt: number | null } {
  if (usage?.fiveHour && usage.fiveHour.percent >= 100) return { error: 'Claude Code has reached its 5-hour limit.', resetsAt: usage.fiveHour.resetsAt };
  if (usage?.week && usage.week.percent >= 100) return { error: 'Claude Code has reached its weekly limit.', resetsAt: usage.week.resetsAt };
  return { error: 'Claude Code has reached its usage limit.', resetsAt: fromMessage };
}

/**
 * Claude summaries. The page names what to sum up (a discovered repo, commit ids); the commits and diffs are read
 * here, and Claude Code runs in the repository with no tools, only when the page asks. Each run can be stopped.
 */
export class SummaryOps {
  private readonly runs = new Map<number, AbortController>();

  constructor(
    private readonly ws: Workspace,
    private readonly deps: SummaryDeps = {},
  ) {}

  private repo(repoPath: unknown) {
    return typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
  }

  /** Stops a run; it resolves as cancelled. */
  cancel(id: unknown): void {
    if (isId(id)) this.runs.get(id)?.abort();
  }

  /** Stops every run (the app is quitting). */
  dispose(): void {
    for (const run of this.runs.values()) run.abort();
  }

  async summarize(id: unknown, request: unknown): Promise<SummaryResult> {
    if (!isId(id) || this.runs.has(id) || typeof request !== 'object' || request === null) return INVALID;
    const controller = new AbortController();
    this.runs.set(id, controller);
    try {
      return await this.run(request as Record<string, unknown>, controller.signal);
    } finally {
      this.runs.delete(id);
    }
  }

  private async run(request: Record<string, unknown>, signal: AbortSignal): Promise<SummaryResult> {
    const kind = request.kind as SummaryRequest['kind'];
    let cwd: string;
    let material: Material | PullRequestMaterial;
    if (kind === 'day') {
      const read = this.dayRepos(request.commits);
      if (read === null || typeof request.label !== 'string') return INVALID;
      // Several repositories: Claude Code runs in the open folder.
      const dir = this.ws.view().dir;
      if (dir === null) return UNKNOWN_REPO;
      cwd = dir;
      material = await dayMaterial(request.label.slice(0, 40), read);
    } else {
      const repo = this.repo(request.repoPath);
      if (!repo) return UNKNOWN_REPO;
      cwd = repo.path;
      switch (kind) {
        case 'incoming':
          material = await incomingMaterial(repo.path);
          break;
        case 'changes':
          material = await changesMaterial(repo.path, { staged: false });
          break;
        case 'message': {
          const changes = await changesMaterial(repo.path, { staged: await hasStaged(repo.path) });
          material = changes.ok ? { ...changes, text: `${block('recent-subjects', await recentSubjects(repo.path))}\n\n${changes.text}` } : changes;
          break;
        }
        case 'stash':
          if (typeof request.oid !== 'string' || !STASH_OID.test(request.oid)) return INVALID;
          material = await stashMaterial(repo.path, request.oid);
          break;
        case 'pullRequest':
          material = await pullRequestMaterial(repo.path);
          break;
        case 'commit': {
          const oid = await this.resolve(repo.path, request.oid);
          if (oid === null) return { ok: false, reason: 'failed', error: 'Commit not found' };
          material = await commitMaterial(repo.path, oid);
          break;
        }
        default:
          return INVALID;
      }
    }
    if (signal.aborted) return CANCELLED;
    if (!material.ok) return { ok: false, reason: 'failed', error: material.error };

    const outcome = await (this.deps.ask ?? askClaude)({ cwd, prompt: promptFor(kind, material.text), signal });
    if (!outcome.ok) {
      if (outcome.reason !== 'limit') return { ok: false, reason: outcome.reason, error: outcome.error };
      const usage = (await this.deps.usage?.().catch(() => null)) ?? null;
      return { ok: false, reason: 'limit', ...limitInfo(usage, outcome.resetsAt ?? null) };
    }
    const at = (this.deps.now ?? Date.now)();
    const done = (text: string, extra: Partial<SummaryDone> = {}): SummaryResult =>
      text === '' ? { ok: false, reason: 'failed', error: 'Claude Code gave no answer' } : { ok: true, text, about: material.ok ? material.about : '', at, ...extra };
    switch (kind) {
      case 'message':
        return done(cleanMessage(outcome.text));
      case 'stash':
        return done(stashMessage(cleanLine(outcome.text)));
      case 'pullRequest': {
        const { title, body } = splitPullRequest(outcome.text);
        return done(title === '' ? '' : body, { title, compareUrl: 'compareUrl' in material ? material.compareUrl : null });
      }
      default:
        return done(unfence(outcome.text));
    }
  }

  /** A commit the page names, as a full id; null if it isn't one. */
  private async resolve(repo: string, oid: unknown): Promise<string | null> {
    if (typeof oid !== 'string' || !OID.test(oid)) return null;
    const resolved = await runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${oid}^{commit}`], { okCodes: [0, 1, 128] });
    const full = resolved.ok ? resolved.stdout.trim() : '';
    return FULL_OID.test(full) ? full : null;
  }

  /** A day's commits from the page: discovered repos and full commit ids only; null if anything else is there. */
  private dayRepos(commits: unknown) {
    if (!Array.isArray(commits) || commits.length > MAX_DAY_REPOS) return null;
    const repos = [];
    let total = 0;
    for (const item of commits) {
      if (typeof item !== 'object' || item === null) return null;
      const { repoPath, oids, unpushed } = item as Record<string, unknown>;
      const repo = this.repo(repoPath);
      if (!repo || !isStrings(oids, MAX_DAY_COMMITS) || !oids.every((oid) => FULL_OID.test(oid))) return null;
      const late = unpushed === undefined ? [] : unpushed;
      if (!isStrings(late, MAX_DAY_COMMITS) || !late.every((oid) => oids.includes(oid))) return null;
      total += oids.length;
      if (total > MAX_DAY_COMMITS) return null;
      repos.push({ path: repo.path, name: repo.name, oids, unpushed: late });
    }
    return repos;
  }
}
