import { join } from 'node:path';
import { diffFile } from '../git/actions.js';
import { parseDiff } from '../git/diffParse.js';
import { OUTPUT_TOO_LARGE } from '../git/exec.js';
import { type DirList, type FileContent, type FileList, OUTSIDE, listDir, listFiles, locateInRepo, readRepoFile } from '../git/files.js';
import { getStatus } from '../git/status.js';
import type { DiffView, OpResult } from '../shared/api.js';
import { openInZed } from './openInZed.js';
import type { Workspace } from './workspace.js';

const UNKNOWN_REPO = { ok: false, error: 'Unknown repository' } as const;
const INVALID_PATH = { ok: false, error: 'Invalid file path' } as const;

/**
 * Bundan büyük diff okunmaz: ayrıştırma ana süreçte (terminal verisini de taşıyan iş parçacığında)
 * çalışır ve görünüm zaten en çok 5.000 satır gösterir.
 */
export const MAX_DIFF_BYTES = 2 * 1_048_576;
export const DIFF_TOO_LARGE = 'This diff is too large to show';

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

  async listFiles(repoPath: unknown): Promise<FileList> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    return listFiles(repo.path);
  }

  /** Repo içindeki bir klasörün tek seviyesi (yok sayılan klasörlerin içi için). */
  async listDir(repoPath: unknown, dirPath: unknown): Promise<DirList> {
    const repo = this.repo(repoPath);
    if (!repo) return UNKNOWN_REPO;
    if (typeof dirPath !== 'string') return INVALID_PATH;
    return listDir(repo.path, dirPath);
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
