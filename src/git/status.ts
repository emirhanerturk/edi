import { runGit } from './exec.js';
import type { FileChange, RepoStatus } from './types.js';

export type { FileChange, RepoStatus } from './types.js';

/** Everything in `s` after the nth space (the path may contain spaces). */
function afterNthSpace(s: string, n: number): string {
  let index = -1;
  for (let i = 0; i < n; i++) {
    index = s.indexOf(' ', index + 1);
    if (index === -1) return '';
  }
  return s.slice(index + 1);
}

/** Parses the output of `git status --porcelain=v2 --branch -z`. */
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
      // The source path of a rename/copy entry comes in a separate NUL-delimited field.
      i++;
      // In a copy the source file stays in place and isn't part of this change; the old path is kept only for renames.
      const renamed = record[2] === 'R' || record[3] === 'R';
      status.files.push({
        path: afterNthSpace(record, 9),
        origPath: renamed ? (records[i] ?? null) : null,
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
    // '!' (ignored) and empty entries are skipped.
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
  // --no-optional-locks: polling doesn't take the index lock, so it doesn't clash with other git commands running at the time.
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
