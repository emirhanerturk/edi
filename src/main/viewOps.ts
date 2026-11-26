import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { diffFile } from '../git/actions.js';
import { blobSize } from '../git/blob.js';
import { parseDiff } from '../git/diffParse.js';
import { OUTPUT_TOO_LARGE } from '../git/exec.js';
import { type DirList, type FileContent, type FileList, OUTSIDE, listDir, listFiles, locateInRepo, readRepoFile, writeRepoFile, MAX_WRITE_BYTES } from '../git/files.js';
import type { WriteResult } from '../git/types.js';
import { type BlameResult, type HeadText, blameText, readHeadText } from '../git/lineInfo.js';
import { getStatus } from '../git/status.js';
import type { DiffView, OpResult } from '../shared/api.js';
import { openIn } from './openIn.js';
import { type EditorId, isEditorId } from '../shared/editors.js';
import { mediaOf } from '../shared/media.js';
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
    private readonly open: (editor: EditorId, target: string) => Promise<OpResult> = openIn,
  ) {}

  private repo(repoPath: unknown) {
    return typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
  }

  /** An image or video's size in bytes: in the working tree, or with `rev` as it was in that commit. Null if it isn't there. */
  async mediaSize(repoPath: unknown, filePath: unknown, rev: unknown): Promise<number | null> {
    const repo = this.repo(repoPath);
    if (!repo || typeof filePath !== 'string' || !mediaOf(filePath)) return null;
    if (rev !== null) return blobSize(repo.path, rev, filePath);
    const located = await locateInRepo(repo.path, filePath);
    if (!located.ok) return null;
    return stat(located.target).then(
      (info) => (info.isFile() ? info.size : null),
      () => null,
    );
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

  /** The file's text at HEAD, to mark the editor's changed lines. */
  async headText(repoPath: unknown, filePath: unknown): Promise<HeadText> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof filePath !== 'string') return INVALID_PATH;
    return readHeadText(repo.path, filePath);
  }

  /** Who last changed each line of the editor's current text. */
  async blame(repoPath: unknown, filePath: unknown, text: unknown): Promise<BlameResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof filePath !== 'string') return INVALID_PATH;
    if (typeof text !== 'string' || text.length > MAX_WRITE_BYTES) return { ok: false, error: 'Invalid text' };
    return blameText(repo.path, filePath, text);
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

  /** Opens the file in an editor; the repo folder if no path is given or the file was deleted. */
  async openIn(editor: unknown, repoPath: unknown, filePath: unknown): Promise<OpResult> {
    if (!isEditorId(editor)) return { ok: false, error: 'Unknown editor' };
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (filePath === null) return this.open(editor, repo.path);
    if (typeof filePath !== 'string') return INVALID_PATH;
    const located = await locateInRepo(repo.path, filePath);
    if (!located.ok) return located.reason === 'outside' ? { ok: false, error: OUTSIDE } : this.open(editor, repo.path);
    // Opens the path the user sees, not the one with links resolved.
    return this.open(editor, join(repo.path, filePath));
  }
}
