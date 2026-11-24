import { readCommit } from '../git/commit.js';
import { runGit } from '../git/exec.js';
import { PAGE, readLog } from '../git/log.js';
import { commitWebUrl } from '../git/remoteUrl.js';
import type { CommitResult, LogResult } from '../git/types.js';
import type { Workspace } from './workspace.js';

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const MAX_COUNT = 5000;
/** Short or full lowercase hex. It can't start with "-", so it can't be mistaken for an option. */
const OID = /^[0-9a-f]{7,64}$/;

/** Read-only operations of the History tab. The repo path, count and commit id are validated before reaching git. */
export class HistoryOps {
  constructor(private readonly ws: Workspace) {}

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
}
