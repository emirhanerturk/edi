import { join } from 'node:path';
import { diffFile } from '../git/actions.js';
import { parseDiff } from '../git/diffParse.js';
import { type FileContent, type FileList, OUTSIDE, listFiles, locateInRepo, readRepoFile } from '../git/files.js';
import { getStatus } from '../git/status.js';
import type { DiffView, OpResult } from '../shared/api.js';
import { openInZed } from './openInZed.js';
import type { Workspace } from './workspace.js';

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const INVALID_PATH = { ok: false, error: 'Invalid file path' } as const;

/**
 * Sayfanın orta panel için istediği salt okunur işlemler. Repo yolu keşfedilmiş listeyle,
 * dosya yolu reponun kendi klasörüyle doğrulanır; hiçbiri repoda bir şey değiştirmez.
 */
export class ViewOps {
  constructor(
    private readonly ws: Workspace,
    private readonly open: (target: string) => Promise<OpResult> = openInZed,
  ) {}

  private repo(repoPath: unknown) {
    return typeof repoPath === 'string' ? this.ws.repo(repoPath) : null;
  }

  /** Dosyanın HEAD'e göre tüm değişikliği. Yol, reponun o anki değişiklik listesinde olmalıdır. */
  async diff(repoPath: unknown, filePath: unknown): Promise<DiffView> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof filePath !== 'string') return INVALID_PATH;
    const read = await getStatus(repo.path);
    if (!read.ok) return { ok: false, error: read.error };
    const file = read.status.files.find((f) => f.path === filePath);
    if (!file) return { ok: false, error: 'File is not in the list of changes' };
    const result = await diffFile(repo.path, read.status, file);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, diff: parseDiff(result.text), file };
  }

  async readFile(repoPath: unknown, filePath: unknown): Promise<FileContent> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof filePath !== 'string') return INVALID_PATH;
    return readRepoFile(repo.path, filePath);
  }

  async listFiles(repoPath: unknown): Promise<FileList> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    return listFiles(repo.path);
  }

  /** Dosyayı Zed'de açar; yol verilmezse ya da dosya silinmişse repo klasörünü. */
  async openInZed(repoPath: unknown, filePath: unknown): Promise<OpResult> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (filePath === null) return this.open(repo.path);
    if (typeof filePath !== 'string') return INVALID_PATH;
    const located = await locateInRepo(repo.path, filePath);
    if (!located.ok) return located.reason === 'outside' ? { ok: false, error: OUTSIDE } : this.open(repo.path);
    // Bağ çözülmüş hâli değil, kullanıcının gördüğü yol açılır.
    return this.open(join(repo.path, filePath));
  }
}
