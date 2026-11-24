import { type RunGitOptions, runGit } from './exec.js';
import { type FileChange, type RepoStatus, getStatus } from './status.js';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
export type DiffResult = { ok: true; text: string } | { ok: false; error: string };

/** git'in boş ağaç nesnesi: henüz commit'i olmayan repoda diff tabanı. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** Index'i ya da çalışma ağacını değiştiren yerel komutlar (büyük bir ilk `add` uzun sürebilir). */
const LOCAL_WRITE_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 120_000;
/**
 * Hook çalıştırabilen ya da çalışma ağacını güncelleyen komutlar: pre-commit / pre-push
 * hook'ları test koşabilir, yarıda kesilen bir pull ağacı yarım bırakır. Bu yüzden süre uzun.
 */
const SLOW_TIMEOUT_MS = 600_000;
const CONFLICT_ERROR = 'Conflicted files present; resolve them outside edi';

/**
 * Yolu glob olarak değil harfi harfine eşleştirir. `app/[slug]/page.tsx` gibi yollar
 * pathspec olarak yorumlanırsa başka dosyalarla da eşleşir.
 */
const literal = (path: string) => `:(literal)${path}`;
/** Renk, harici diff aracı ve yol kaçışları kapalı: çıktı her ayarda düz ve okunur metin. */
const DIFF_ARGS = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff'];

async function act(repo: string, args: string[], message: string, opts?: RunGitOptions): Promise<ActionResult> {
  const result = await runGit(repo, args, opts);
  return result.ok ? { ok: true, message } : { ok: false, error: result.error };
}

export function stageFile(repo: string, f: FileChange): Promise<ActionResult> {
  return act(repo, ['add', '-A', '--', literal(f.path)], 'Staged', { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
}

/** Yalnız index'e dokunur; çalışma ağacındaki içerik değişmez. */
export function unstageFile(repo: string, f: FileChange): Promise<ActionResult> {
  const paths = f.origPath === null ? [f.path] : [f.path, f.origPath];
  return act(repo, ['reset', '-q', '--', ...paths.map(literal)], 'Unstaged', {
    timeoutMs: LOCAL_WRITE_TIMEOUT_MS,
  });
}

/**
 * Çakışmalı dosya varken reddeder: `git add` çakışmayı "çözüldü" diye işaretler ve
 * çakışma işaretleri commit'e girer. Çakışma çözümü edi'nin kapsamı dışında.
 */
export async function stageAll(repo: string): Promise<ActionResult> {
  const current = await getStatus(repo);
  if (!current.ok) return { ok: false, error: current.error };
  if (current.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  return act(repo, ['add', '-A'], 'Staged', { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
}

/** Yalnız index'e dokunur; çalışma ağacındaki içerik değişmez. */
export function unstageAll(repo: string): Promise<ActionResult> {
  // Yol verilmeden `git reset` yarıda kalmış merge/cherry-pick durumunu (MERGE_HEAD) da siler;
  // `-- .` ile yalnız index sıfırlanır.
  return act(repo, ['reset', '-q', '--', '.'], 'Unstaged', { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
}

export async function commit(repo: string, message: string, opts: { addAll: boolean }): Promise<ActionResult> {
  const trimmed = message.trim();
  if (trimmed === '') return { ok: false, error: 'Commit message is empty' };
  if (opts.addAll) {
    const added = await stageAll(repo);
    if (!added.ok) return added;
  }
  return act(repo, ['commit', '-m', trimmed], 'Committed', { timeoutMs: SLOW_TIMEOUT_MS });
}

export function push(repo: string, status: RepoStatus): Promise<ActionResult> {
  if (status.detached) return Promise.resolve({ ok: false, error: 'Detached HEAD: cannot push' });
  // Tam ref adı: aynı adlı bir etiket varsa kısa ad belirsiz kalır.
  const args = status.upstream === null ? ['push', '-u', 'origin', `refs/heads/${status.head}`] : ['push'];
  return act(repo, args, 'Pushed', { timeoutMs: SLOW_TIMEOUT_MS });
}

export function pull(repo: string): Promise<ActionResult> {
  return act(repo, ['pull', '--ff-only'], 'Pulled', { timeoutMs: SLOW_TIMEOUT_MS });
}

export function fetchRepo(repo: string): Promise<ActionResult> {
  return act(repo, ['fetch'], 'Fetched', { timeoutMs: FETCH_TIMEOUT_MS });
}

export async function listBranches(
  repo: string,
): Promise<{ ok: true; branches: string[]; current: string | null } | { ok: false; error: string }> {
  const refs = await runGit(repo, ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads']);
  if (!refs.ok) return { ok: false, error: refs.error };
  // Detached HEAD'de 1 ile çıkar; bu hata değil, "geçerli branch yok" demek.
  const currentRef = await runGit(repo, ['symbolic-ref', '-q', 'HEAD'], { okCodes: [0, 1] });
  if (!currentRef.ok) return { ok: false, error: currentRef.error };
  return {
    ok: true,
    branches: refs.stdout.split('\n').filter((name) => name !== ''),
    current: currentRef.stdout.trim().replace(/^refs\/heads\//, '') || null,
  };
}

/** `-` ile başlayan ad git'e seçenek olarak geçer (`--detach` gibi); boş ad da geçersizdir. */
const invalidBranch = (name: string): ActionResult | null =>
  name.trim() === '' || name.startsWith('-') ? { ok: false, error: 'Invalid branch name' } : null;

export async function switchBranch(repo: string, name: string): Promise<ActionResult> {
  const invalid = invalidBranch(name);
  if (invalid) return invalid;
  return act(repo, ['switch', '-q', name], `Switched to ${name}`, { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
}

export async function createBranch(repo: string, name: string): Promise<ActionResult> {
  const invalid = invalidBranch(name);
  if (invalid) return invalid;
  return act(repo, ['switch', '-q', '-c', name], `Switched to ${name}`, {
    timeoutMs: LOCAL_WRITE_TIMEOUT_MS,
  });
}

const diffBase = (status: RepoStatus) => (status.unborn ? EMPTY_TREE : 'HEAD');

function untrackedDiff(repo: string, path: string) {
  // --no-index fark bulduğunda 1 ile çıkar.
  return runGit(repo, [...DIFF_ARGS, '--no-index', '--', '/dev/null', path], { okCodes: [0, 1] });
}

/** Dosyanın HEAD'e göre tüm değişikliği (stage'li + stage'siz); yeni dosyada tamamı ekleme olarak. */
export async function diffFile(repo: string, status: RepoStatus, f: FileChange): Promise<DiffResult> {
  const paths = f.origPath === null ? [f.path] : [f.path, f.origPath];
  const result =
    f.kind === 'untracked'
      ? await untrackedDiff(repo, f.path)
      : await runGit(repo, [...DIFF_ARGS, '-M', diffBase(status), '--', ...paths.map(literal)]);
  return result.ok ? { ok: true, text: result.stdout } : { ok: false, error: result.error };
}
