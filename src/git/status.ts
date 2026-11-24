import { runGit } from './exec.js';

export interface FileChange {
  path: string;
  /** Rename/kopya kaydında dosyanın eski yolu. */
  origPath: string | null;
  /** Index (stage) durumu; değişiklik yoksa '.'. */
  x: string;
  /** Çalışma ağacı durumu; değişiklik yoksa '.'. */
  y: string;
  kind: 'changed' | 'untracked' | 'conflicted';
}

export interface RepoStatus {
  /** Branch adı; detached HEAD'de kısa commit hash'i. */
  head: string;
  /** HEAD commit'inin tam oid'i; henüz commit yoksa null. */
  headOid: string | null;
  detached: boolean;
  /** Repoda henüz hiç commit yok. */
  unborn: boolean;
  upstream: string | null;
  /** Upstream yoksa ya da silinmişse null. */
  ahead: number | null;
  behind: number | null;
  files: FileChange[];
}

/** `s` içinde n. boşluktan sonraki her şey (yol boşluk içerebilir). */
function afterNthSpace(s: string, n: number): string {
  let index = -1;
  for (let i = 0; i < n; i++) {
    index = s.indexOf(' ', index + 1);
    if (index === -1) return '';
  }
  return s.slice(index + 1);
}

/** `git status --porcelain=v2 --branch -z` çıktısını ayrıştırır. */
export function parseStatus(raw: string): RepoStatus {
  const status: RepoStatus = {
    head: '',
    headOid: null,
    detached: false,
    unborn: false,
    upstream: null,
    ahead: null,
    behind: null,
    files: [],
  };
  let oid = '';
  const records = raw.split('\0');

  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? '';
    const type = record[0];

    if (type === '#') {
      const [, key, ...rest] = record.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') oid = value;
      else if (key === 'branch.head') status.head = value;
      else if (key === 'branch.upstream') status.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          status.ahead = Number(match[1]);
          status.behind = Number(match[2]);
        }
      }
    } else if (type === '1') {
      status.files.push({
        path: afterNthSpace(record, 8),
        origPath: null,
        x: record[2] ?? '.',
        y: record[3] ?? '.',
        kind: 'changed',
      });
    } else if (type === '2') {
      // Rename kaydının eski yolu ayrı bir NUL alanında gelir.
      i++;
      status.files.push({
        path: afterNthSpace(record, 9),
        origPath: records[i] ?? null,
        x: record[2] ?? '.',
        y: record[3] ?? '.',
        kind: 'changed',
      });
    } else if (type === 'u') {
      status.files.push({
        path: afterNthSpace(record, 10),
        origPath: null,
        x: record[2] ?? 'U',
        y: record[3] ?? 'U',
        kind: 'conflicted',
      });
    } else if (type === '?') {
      status.files.push({ path: record.slice(2), origPath: null, x: '?', y: '?', kind: 'untracked' });
    }
    // '!' (yok sayılan) ve boş kayıtlar atlanır.
  }

  status.unborn = oid === '(initial)';
  status.headOid = status.unborn || oid === '' ? null : oid;
  if (status.head === '(detached)') {
    status.detached = true;
    status.head = oid.slice(0, 7);
  }
  return status;
}

export async function getStatus(
  repoPath: string,
): Promise<{ ok: true; status: RepoStatus } | { ok: false; error: string }> {
  // --no-optional-locks: yoklama index kilidi almaz, o sırada çalışan başka git komutlarıyla çakışmaz.
  const result = await runGit(repoPath, [
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    '--untracked-files=all',
  ]);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, status: parseStatus(result.stdout) };
}

export function isStaged(f: FileChange): boolean {
  return f.kind === 'changed' && f.x !== '.';
}

export function hasUnstaged(f: FileChange): boolean {
  return f.kind === 'untracked' || (f.kind === 'changed' && f.y !== '.');
}

export function isDeleted(f: FileChange): boolean {
  return f.kind === 'changed' && (f.y === 'D' || (f.y === '.' && f.x === 'D'));
}

export function statusLetter(f: FileChange): string {
  if (f.kind === 'untracked') return '?';
  if (f.kind === 'conflicted') return 'U';
  return f.y !== '.' ? f.y : f.x;
}
