import { readCommit } from '../git/commit.js';
import { runGit } from '../git/exec.js';
import { PAGE, readLog } from '../git/log.js';
import { commitWebUrl } from '../git/remoteUrl.js';
import type { CommitResult, LogResult } from '../git/types.js';
import type { CommitMenuAction, CommitMenuChoice } from '../shared/api.js';
import type { Workspace } from './workspace.js';

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const MAX_COUNT = 5000;
/** Short or full lowercase hex. It can't start with "-", so it can't be mistaken for an option. */
const OID = /^[0-9a-f]{7,64}$/;
/** A full commit id, as the page has it for a commit it shows. */
const FULL_OID = /^[0-9a-f]{40,64}$/;

export interface CommitMenuItem {
  id: CommitMenuAction | null;
  label: string;
  enabled?: boolean;
}

export interface HistoryDeps {
  /** Shows the native menu; `-` labels are separators. Resolves with the chosen item's id, or null. */
  menu(items: CommitMenuItem[]): Promise<CommitMenuAction | null>;
}

/** Operations of the History tab. The repo path, count and commit id are validated before reaching git. */
export class HistoryOps {
  constructor(
    private readonly ws: Workspace,
    private readonly deps?: HistoryDeps,
  ) {}

  private repo(repoPath: unknown) {
    return typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
  }

  async log(repoPath: unknown, count: unknown): Promise<LogResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < PAGE || count > MAX_COUNT || count % PAGE !== 0) {
      return { ok: false, error: 'Invalid count' };
    }
    return readLog(repo.path, count);
  }

  async commit(repoPath: unknown, oid: unknown): Promise<CommitResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof oid !== 'string' || !OID.test(oid)) return { ok: false, error: 'Invalid commit' };
    const resolved = await runGit(repo.path, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${oid}^{commit}`], { okCodes: [0, 1, 128] });
    const full = resolved.ok ? resolved.stdout.trim() : '';
    if (!/^[0-9a-f]{40,64}$/.test(full)) return { ok: false, error: 'Commit not found' };
    const [result, webUrl] = await Promise.all([readCommit(repo.path, full), commitWebUrl(repo.path, full)]);
    return result.ok ? { ...result, webUrl } : result;
  }

  /** A commit's menu: Copy SHA and Open on GitHub (if it has a page) with `links`, then Revert Commit…. */
  async commitMenu(repoPath: unknown, oid: unknown, opts: unknown): Promise<CommitMenuChoice | null> {
    const repo = this.repo(repoPath);
    if (!repo || !this.deps || typeof oid !== 'string' || !FULL_OID.test(oid) || typeof opts !== 'object' || opts === null) return null;
    const { links, canRevert } = opts as Record<string, unknown>;
    const url = links === true ? await commitWebUrl(repo.path, oid) : null;
    const items: CommitMenuItem[] = [];
    if (links === true) {
      items.push({ id: 'copy', label: 'Copy SHA' });
      if (url !== null) items.push({ id: 'github', label: 'Open on GitHub' });
      items.push({ id: null, label: '-' });
    }
    items.push({ id: 'revert', label: 'Revert Commit…', enabled: canRevert === true });
    const picked = await this.deps.menu(items);
    if (picked === 'github') return url === null ? null : { action: 'github', url };
    return picked === null ? null : { action: picked };
  }
}
