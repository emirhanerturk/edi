import { staysInside } from '../git/files.js';
import { MAX_REPLACEMENT, STOPPED, replaceInFile, searchRepo, textQuery } from '../git/textSearch.js';
import type { ReplaceResult, TextSearchResult } from '../git/types.js';
import type { Workspace } from './workspace.js';

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const INVALID = { ok: false, error: 'Invalid search' } as const;
const STAMP = /^[0-9a-f]{40}$/;
const MAX_LINES = 100_000;

/**
 * The Search tab's operations. The page names a discovered repo, a file inside it and the search as
 * plain values; the pattern runs here, under a time limit, and a file is written only if it still holds
 * the text that was searched.
 */
export class SearchOps {
  /** The newest search: an older one stops between files. */
  private latest = 0;

  constructor(private readonly ws: Workspace) {}

  private repo(repoPath: unknown) {
    return typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
  }

  private isId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;

  async search(repoPath: unknown, query: unknown, id: unknown): Promise<TextSearchResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    const q = textQuery(query);
    if (!q || !this.isId(id)) return INVALID;
    if (id < this.latest) return { ok: false, error: STOPPED };
    this.latest = id;
    return searchRepo(repo.path, q, { stopped: () => this.latest !== id });
  }

  /** Stops the searches running: their ids are older than `id`. */
  stop(id: unknown): void {
    if (this.isId(id) && id > this.latest) this.latest = id;
  }

  async replace(repoPath: unknown, path: unknown, query: unknown, replacement: unknown, stamp: unknown, lines: unknown): Promise<ReplaceResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    const q = textQuery(query);
    if (!q || !staysInside(path) || typeof replacement !== 'string' || replacement.length > MAX_REPLACEMENT) return INVALID;
    if (typeof stamp !== 'string' || !STAMP.test(stamp)) return INVALID;
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) return INVALID;
    if (!lines.every((line) => typeof line === 'number' && Number.isInteger(line) && line >= 1)) return INVALID;
    return replaceInFile(repo.path, path, q, replacement, stamp, lines as number[]);
  }
}
