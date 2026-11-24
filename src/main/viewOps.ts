import { join } from 'node:path';
import { diffFile } from '../git/actions.js';
import { parseDiff } from '../git/diffParse.js';
import { OUTPUT_TOO_LARGE } from '../git/exec.js';
import { type DirList, type FileContent, type FileList, OUTSIDE, listDir, listFiles, locateInRepo, readRepoFile, writeRepoFile } from '../git/files.js';
import type { WriteResult } from '../git/types.js';
import { getStatus } from '../git/status.js';
import type { DiffView, OpResult } from '../shared/api.js';
import { openInZed } from './openInZed.js';
import type { Workspace } from './workspace.js';

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const INVALID_PATH = { ok: false, error: 'Invalid file path' } as const;

/**
 * A diff larger than this isn't read: parsing runs in the main process (on the thread that also carries
 * terminal data) and the view shows at most 5,000 lines anyway.
 */
export const MAX_DIFF_BYTES = 2 * 1_048_576;
export const DIFF_TOO_LARGE = 'This diff is too large to show';

/**
 * Operations the page requests for the middle panel. The repo path is validated against the discovered list,
 * the file path against the repo's own folder. Only `writeFile` changes the repo: it saves editor text over an
 * existing file.
 */
export class ViewOps {
  constructor(
    private readonly ws: Workspace,
    private readonly open: (target: string) => Promise<OpResult> = openInZed,
  ) {}

  private repo(repoPath: unknown) {
    return typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
  }

  /** The file's full change against HEAD. The path must be in the repo's current list of changes. */
  async diff(repoPath: unknown, filePath: unknown): Promise<DiffView> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof filePath !== 'string') return INVALID_PATH;
    const read = await getStatus(repo.path);
    if (!read.ok) return { ok: false, error: read.error };
    const file = read.status.files.find((f) => f.path === filePath);
    if (!file) return { ok: false, error: 'File is not in the list of changes' };
    const result = await diffFile(repo.path, read.status, file, MAX_DIFF_BYTES);
    if (!result.ok) return { ok: false, error: result.error === OUTPUT_TOO_LARGE ? DIFF_TOO_LARGE : result.error };
    return { ok: true, diff: parseDiff(result.text), file };
  }

  async readFile(repoPath: unknown, filePath: unknown): Promise<FileContent> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof filePath !== 'string') return INVALID_PATH;
    return readRepoFile(repo.path, filePath);
  }

  /** Saves editor text; `expected` is the disk text the edit started from (`null`: overwrite regardless). */
  async writeFile(repoPath: unknown, filePath: unknown, text: unknown, expected: unknown): Promise<WriteResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof filePath !== 'string') return INVALID_PATH;
    const result = await writeRepoFile(repo.path, filePath, text, expected);
    // The Git tab shows the change at once instead of on the next poll.
    if (result.ok) await this.ws.refresh(repo.path).catch(() => undefined);
    return result;
  }

  async listFiles(repoPath: unknown): Promise<FileList> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    return listFiles(repo.path);
  }

  /** One level of a folder inside the repo (for the contents of ignored folders). */
  async listDir(repoPath: unknown, dirPath: unknown): Promise<DirList> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof dirPath !== 'string') return INVALID_PATH;
    return listDir(repo.path, dirPath);
  }

  /** Opens the file in Zed; the repo folder if no path is given or the file was deleted. */
  async openInZed(repoPath: unknown, filePath: unknown): Promise<OpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (filePath === null) return this.open(repo.path);
    if (typeof filePath !== 'string') return INVALID_PATH;
    const located = await locateInRepo(repo.path, filePath);
    if (!located.ok) return located.reason === 'outside' ? { ok: false, error: OUTSIDE } : this.open(repo.path);
    // Opens the path the user sees, not the one with links resolved.
    return this.open(join(repo.path, filePath));
  }
}
