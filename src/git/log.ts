// Reads the latest commits on a repo's current branch (HEAD). Read-only.
import { runGit } from './exec.js';
import type { CommitSummary, LogResult } from './types.js';

export type { CommitSummary, LogResult };

/** Number of commits read per repo per page. */
export const PAGE = 50;

/**
 * Output independent of the user's config: signature verification, color and quoted paths are off.
 * The format is always given explicitly (`format.pretty` has no effect).
 */
export const PINNED = [
  '-c',
  'log.showSignature=false',
  '-c',
  'color.ui=false',
  '-c',
  'core.quotePath=false',
  // Output is read as UTF-8: a repo set to write logs in another encoding would garble non-ASCII letters.
  '-c',
  'i18n.logOutputEncoding=UTF-8',
];

/**
 * Environment for History reads: in a partial clone (`--filter=blob:none`), git is stopped from going to the
 * remote on its own for missing content. Viewing doesn't touch the network or write to `.git`.
 */
export const NO_LAZY_FETCH = { GIT_NO_LAZY_FETCH: '1' };

const US = '\x1f';
/** Fields are separated by the unit separator and records (with `-z`) by NUL: neither can appear in a subject line. */
export const SUMMARY_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%ct', '%D', '%s'].join('%x1f');

/** Tags from the `%D` field: "HEAD -> main, tag: v1.2.0, origin/main". */
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

/** Parses the output of `git log -z --format=<SUMMARY_FORMAT>`. */
export function parseLog(out: string): CommitSummary[] {
  const commits: CommitSummary[] = [];
  for (const record of out.split('\0')) {
    // git sometimes leaves a newline between records.
    const summary = parseSummary(record.replace(/^\n/, '').split(US));
    if (summary) commits.push(summary);
  }
  return commits;
}

const lines = (stdout: string) => stdout.split('\n').map((line) => line.trim()).filter(Boolean);

async function upstreamOf(repo: string): Promise<string | null> {
  // If there is no upstream or the remote branch was deleted, git exits with an error (even though it writes "@{u}" to stdout).
  const result = await runGit(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const name = result.ok ? result.stdout.trim() : '';
  return name === '' ? null : name;
}

/**
 * The loaded commits that haven't been pushed. Relative to the upstream if there is one; otherwise those on no
 * remote branch; if there is no remote at all, none (there is nowhere to push, so the arrow would be noise).
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

/** At most `count` commits going back from HEAD. Returns an empty list in a repo with no commits. */
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
