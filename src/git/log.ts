// Bir reponun geçerli branch'indeki (HEAD) son commit'leri okur. Yalnız okur.
import { runGit } from './exec.js';
import type { CommitSummary, LogResult } from './types.js';

export type { CommitSummary, LogResult };

/** Bir sayfada repo başına okunan commit sayısı. */
export const PAGE = 50;

/**
 * Kullanıcının ayarlarından bağımsız çıktı: imza doğrulaması, renk ve tırnaklı yollar kapalı.
 * Biçim her zaman açıkça verilir (`format.pretty` etkisizdir).
 */
export const PINNED = ['-c', 'log.showSignature=false', '-c', 'color.ui=false', '-c', 'core.quotePath=false'];

/**
 * History okumaları için ortam: partial clone'da (`--filter=blob:none`) eksik içerik için git'in
 * kendiliğinden uzak repoya gitmesi kapalıdır. Görüntülemek ağa çıkmaz, `.git`'e yazmaz.
 */
export const NO_LAZY_FETCH = { GIT_NO_LAZY_FETCH: '1' };

const US = '\x1f';
/** Alanlar birim ayracıyla, kayıtlar (`-z` ile) NUL ile ayrılır: konu satırında ikisi de bulunamaz. */
export const SUMMARY_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%ct', '%D', '%s'].join('%x1f');

/** `%D` alanından etiketler: "HEAD -> main, tag: v1.2.0, origin/main". */
function tagsOf(decoration: string): string[] {
  return decoration
    .split(', ')
    .filter((item) => item.startsWith('tag: '))
    .map((item) => item.slice('tag: '.length));
}

export function parseSummary(fields: string[]): CommitSummary | null {
  const [oid, short, parents, authorName, authorEmail, time, decoration, subject] = fields;
  if (!oid || !/^[0-9a-f]{40,64}$/.test(oid)) return null;
  return {
    oid,
    short: short ?? oid.slice(0, 7),
    subject: subject ?? '',
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    date: Number(time) * 1000,
    parents: parents ? parents.split(' ').filter(Boolean).length : 0,
    tags: tagsOf(decoration ?? ''),
  };
}

/** `git log -z --format=<SUMMARY_FORMAT>` çıktısını ayrıştırır. */
export function parseLog(out: string): CommitSummary[] {
  const commits: CommitSummary[] = [];
  for (const record of out.split('\0')) {
    // Kayıtlar arasında git bazen satır sonu bırakır.
    const summary = parseSummary(record.replace(/^\n/, '').split(US));
    if (summary) commits.push(summary);
  }
  return commits;
}

const lines = (stdout: string) => stdout.split('\n').map((line) => line.trim()).filter(Boolean);

async function upstreamOf(repo: string): Promise<string | null> {
  // Upstream yoksa ya da uzaktaki branch silinmişse git hata ile çıkar (stdout'a "@{u}" yazsa da).
  const result = await runGit(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const name = result.ok ? result.stdout.trim() : '';
  return name === '' ? null : name;
}

/**
 * Yüklenen commit'lerden push edilmemiş olanlar. Upstream varsa ona göre; yoksa uzaktaki hiçbir
 * branch'te olmayanlar; remote hiç yoksa hiçbiri (push edilecek yer yok, ok işareti gürültü olur).
 */
async function unpushedOf(repo: string, upstream: string | null, limit: number): Promise<string[]> {
  if (upstream !== null) {
    const result = await runGit(repo, ['rev-list', `--max-count=${limit}`, 'HEAD', '--not', '@{u}', '--'], { env: NO_LAZY_FETCH });
    return result.ok ? lines(result.stdout) : [];
  }
  const remotes = await runGit(repo, ['remote']);
  if (!remotes.ok || lines(remotes.stdout).length === 0) return [];
  const result = await runGit(repo, ['rev-list', `--max-count=${limit}`, 'HEAD', '--not', '--remotes', '--'], { env: NO_LAZY_FETCH });
  return result.ok ? lines(result.stdout) : [];
}

/** HEAD'den geriye en çok `count` commit. Commit'i olmayan repoda boş liste döner. */
export async function readLog(repo: string, count: number): Promise<LogResult> {
  const [head, email] = await Promise.all([
    runGit(repo, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { okCodes: [0, 1], env: NO_LAZY_FETCH }),
    runGit(repo, ['config', '--get', 'user.email'], { okCodes: [0, 1] }),
  ]);
  if (!head.ok) return { ok: false, error: head.error };
  const userEmail = email.ok && email.stdout.trim() !== '' ? email.stdout.trim() : null;
  if (head.stdout.trim() === '') return { ok: true, commits: [], hasMore: false, unpushed: [], upstream: null, userEmail };

  const limit = count + 1;
  const [log, upstream] = await Promise.all([
    runGit(repo, [...PINNED, 'log', '-z', '--no-color', '--decorate=short', '--abbrev=7', `--format=${SUMMARY_FORMAT}`, `--max-count=${limit}`, 'HEAD', '--'], { env: NO_LAZY_FETCH }),
    upstreamOf(repo),
  ]);
  if (!log.ok) return { ok: false, error: log.error };
  const all = parseLog(log.stdout);
  const unpushed = await unpushedOf(repo, upstream, limit);
  const commits = all.slice(0, count);
  const loaded = new Set(commits.map((commit) => commit.oid));
  return { ok: true, commits, hasMore: all.length > count, unpushed: unpushed.filter((oid) => loaded.has(oid)), upstream, userEmail };
}
