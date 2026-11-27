// What a Claude summary is about, read from git as text: commit messages, the files changed and the diff, cut to a
// size. Read-only, and nothing is fetched (GIT_NO_LAZY_FETCH).
import { type GitResult, OUTPUT_TOO_LARGE, runGit } from './exec.js';
import { NO_LAZY_FETCH, PINNED } from './log.js';
import { repoWebUrl } from './remoteUrl.js';
import { GONE, listStashes } from './stash.js';

/** Characters of diff sent at most; past that the diff is cut, and says so. */
export const MAX_DIFF = 60_000;
/** Commits listed at most. */
export const MAX_COMMITS = 50;
/** New files whose content goes along (the rest by name), and how much of each. */
export const MAX_NEW_FILES = 20;
const MAX_NEW_FILE = 4000;
/** A pull request template longer than this is cut. */
const MAX_TEMPLATE = 4000;
/** Reading a diff larger than this is given up: it couldn't be sent anyway. */
const MAX_READ = 4 * 1_048_576;
/** Stashes looked through for one named by its id. */
const FIND_LIMIT = 1000;

export type Material = { ok: true; text: string; about: string } | { ok: false; error: string };

/** Lock files and built files: listed with the others, but their lines would only crowd the diff out. */
const NOISE = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'Podfile.lock',
  'go.sum',
  '*.min.js',
  '*.min.css',
  '*.map',
];
export const QUIET_PATHS = NOISE.map((name) => `:(exclude,glob)**/${name}`);

const DATE = '--date=format:%Y-%m-%d %H:%M';
/** A commit as `git log` shows it, with tags and branches beside the id; the message indented. */
const COMMIT_FORMAT = '--format=commit %h%d%nAuthor: %an%nDate: %ad%n%n%w(0,4,4)%B';
/** Diffs as plain text whatever the user's config: no color, no external diff or text conversion programs. */
const DIFF = [...PINNED, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M'];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const commitsAbout = (n: number) => plural(n, 'commit');

/** Cuts text to `max` characters at a line break, saying how much was left out. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max);
  const end = cut > max / 2 ? cut : max;
  return `${text.slice(0, end)}\n[… ${text.length - end} more characters left out]`;
}

/** A tagged block of material; empty text gives nothing. */
export function block(tag: string, text: string, attrs = ''): string {
  const body = text.replace(/\s+$/, '');
  return body === '' ? '' : `<${tag}${attrs}>\n${body}\n</${tag}>`;
}

const join = (...parts: string[]) => parts.filter((part) => part !== '').join('\n\n');

const read = (repo: string, args: string[], opts: { okCodes?: number[]; maxOutput?: number } = {}): Promise<GitResult> =>
  runGit(repo, args, { env: NO_LAZY_FETCH, ...opts });

/** The empty tree's id in this repo's hash: what a first commit, or a repo with none yet, is compared with. */
async function emptyTree(repo: string): Promise<string> {
  const result = await read(repo, ['hash-object', '-t', 'tree', '/dev/null']);
  const oid = result.ok ? result.stdout.trim() : '';
  return /^[0-9a-f]{40,64}$/.test(oid) ? oid : '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
}

async function headOid(repo: string): Promise<string | null> {
  const result = await read(repo, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { okCodes: [0, 1] });
  const oid = result.ok ? result.stdout.trim() : '';
  return oid === '' ? null : oid;
}

async function countOf(repo: string, range: string): Promise<number> {
  const result = await read(repo, ['rev-list', '--count', range, '--']);
  const n = result.ok ? Number(result.stdout.trim()) : NaN;
  return Number.isInteger(n) ? n : 0;
}

/** Lines added and removed by the numstat output; binary files count as none. */
export function numstatTotals(out: string): { files: number; lines: number } {
  let files = 0;
  let lines = 0;
  for (const row of out.split('\n')) {
    const [added, removed] = row.split('\t');
    if (added === undefined || removed === undefined) continue;
    files++;
    lines += (Number(added) || 0) + (Number(removed) || 0);
  }
  return { files, lines };
}

interface Diff {
  text: string;
  files: number;
  lines: number;
}

/** The files a diff changes (with counts) and the diff itself, lock and built files left out of the latter. */
async function diffOf(repo: string, revs: string[], budget = MAX_DIFF): Promise<Diff> {
  const [stat, numstat, patch] = await Promise.all([
    read(repo, [...DIFF, '--stat=160,120', ...revs, '--']),
    read(repo, [...DIFF, '--numstat', ...revs, '--']),
    read(repo, [...DIFF, '--patch', ...revs, '--', ...QUIET_PATHS], { maxOutput: MAX_READ }),
  ]);
  const totals = numstat.ok ? numstatTotals(numstat.stdout) : { files: 0, lines: 0 };
  const diff = patch.ok ? clip(patch.stdout, budget) : !patch.ok && patch.error === OUTPUT_TOO_LARGE ? '[The diff is too large to include.]' : '';
  return { text: join(block('files', stat.ok ? stat.stdout : ''), block('diff', diff)), ...totals };
}

/** Commit messages in `range`, newest first, at most MAX_COMMITS. */
async function messagesOf(repo: string, range: string[]): Promise<string> {
  const log = await read(repo, [...PINNED, 'log', DATE, COMMIT_FORMAT, `--max-count=${MAX_COMMITS}`, ...range, '--']);
  return log.ok ? log.stdout : '';
}

/** What a pull would bring: the upstream's commits the branch doesn't have, and their change since the two parted. */
export async function incomingMaterial(repo: string): Promise<Material> {
  const upstream = await read(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const name = upstream.ok ? upstream.stdout.trim() : '';
  if (name === '') return { ok: false, error: 'The branch has no upstream' };
  const count = await countOf(repo, 'HEAD..@{u}');
  if (count === 0) return { ok: false, error: 'Nothing to pull' };
  const [messages, diff] = await Promise.all([messagesOf(repo, ['HEAD..@{u}']), diffOf(repo, ['HEAD...@{u}'])]);
  return {
    ok: true,
    about: commitsAbout(count),
    text: join(`Pulling from ${name}: ${commitsAbout(count)}.`, block('commits', messages), diff.text),
  };
}

/** New files: their content (as a diff from nothing) for the first MAX_NEW_FILES, the rest by name. */
async function newFiles(repo: string): Promise<Diff> {
  const listed = await read(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
  const paths = listed.ok ? listed.stdout.split('\0').filter((path) => path !== '') : [];
  let text = '';
  let lines = 0;
  for (const path of paths.slice(0, MAX_NEW_FILES)) {
    // Exit 1: the file differs from nothing, which is the point.
    const diff = await read(repo, ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--', '/dev/null', path], { okCodes: [0, 1], maxOutput: MAX_READ });
    if (!diff.ok) continue;
    lines += diff.stdout.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
    text += `${clip(diff.stdout, MAX_NEW_FILE)}\n`;
  }
  const rest = paths.slice(MAX_NEW_FILES);
  if (rest.length > 0) text += `[${plural(rest.length, 'more new file')}: ${rest.join(', ')}]\n`;
  return { text: block('new-files', text), files: paths.length, lines };
}

/**
 * The uncommitted changes: the staged ones alone (`staged`), or everything against HEAD, new files included,
 * as "Commit all" would commit it. Before the first commit, against nothing.
 */
export async function changesMaterial(repo: string, opts: { staged: boolean }): Promise<Material> {
  const base = (await headOid(repo)) ?? (await emptyTree(repo));
  const [tracked, added] = await Promise.all([diffOf(repo, opts.staged ? ['--cached', base] : [base]), opts.staged ? null : newFiles(repo)]);
  const files = tracked.files + (added?.files ?? 0);
  if (files === 0) return { ok: false, error: 'No changes' };
  const lines = tracked.lines + (added?.lines ?? 0);
  return {
    ok: true,
    about: `${plural(files, 'file')}, ${plural(lines, 'line')}`,
    text: join(opts.staged ? 'The staged changes:' : 'The uncommitted changes, staged or not, and the new files:', tracked.text, added?.text ?? ''),
  };
}

/** Whether anything is staged. */
export async function hasStaged(repo: string): Promise<boolean> {
  const base = (await headOid(repo)) ?? (await emptyTree(repo));
  const names = await read(repo, ['diff', '--cached', '--name-only', base, '--']);
  return names.ok && names.stdout.trim() !== '';
}

/** The latest commit subjects on `rev` (HEAD by default): the repository's style. Empty before the first commit. */
export async function recentSubjects(repo: string, rev = 'HEAD', count = 30): Promise<string> {
  const log = await read(repo, [...PINNED, 'log', '--no-merges', '--format=%s', `--max-count=${count}`, rev, '--'], { okCodes: [0, 128] });
  return log.ok ? log.stdout : '';
}

/** A stash: what it changes against the commit it was made on, and its new files. */
export async function stashMaterial(repo: string, oid: string): Promise<Material> {
  const list = await listStashes(repo, FIND_LIMIT);
  if (!list.ok) return list;
  const entry = list.stashes.find((stash) => stash.oid === oid);
  if (!entry) return { ok: false, error: GONE };
  const [tracked, added] = await Promise.all([
    diffOf(repo, [`${oid}^1`, oid]),
    entry.untracked ? diffOf(repo, [await emptyTree(repo), `${oid}^3`], MAX_DIFF / 2) : null,
  ]);
  const files = tracked.files + (added?.files ?? 0);
  return {
    ok: true,
    about: plural(files, 'file'),
    text: join(`Stash: ${entry.subject}`, tracked.text, added ? block('new-files', added.text) : ''),
  };
}

const TEMPLATES = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
];

/** The repository's pull request template, as committed; empty if it has none. */
async function templateOf(repo: string): Promise<string> {
  for (const path of TEMPLATES) {
    const shown = await read(repo, ['show', `HEAD:${path}`], { okCodes: [0, 128], maxOutput: MAX_READ });
    if (shown.ok && shown.stdout.trim() !== '') return clip(shown.stdout, MAX_TEMPLATE);
  }
  return '';
}

async function config(repo: string, key: string): Promise<string> {
  const result = await read(repo, ['config', '--get', key], { okCodes: [0, 1] });
  return result.ok ? result.stdout.trim() : '';
}

async function refExists(repo: string, ref: string): Promise<boolean> {
  const result = await read(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { okCodes: [0, 1] });
  return result.ok && result.stdout.trim() !== '';
}

/** The branch a pull request would go into: the remote's default branch (`origin/HEAD`), else its main or master. */
async function baseOf(repo: string, remote: string): Promise<string | null> {
  const head = await read(repo, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { okCodes: [0, 1] });
  const named = head.ok ? head.stdout.trim() : '';
  if (named !== '' && (await refExists(repo, named))) return named;
  for (const branch of ['main', 'master']) {
    if (await refExists(repo, `${remote}/${branch}`)) return `${remote}/${branch}`;
  }
  return null;
}

const pathOf = (branch: string) => branch.split('/').map(encodeURIComponent).join('/');

export type PullRequestMaterial = (Material & { ok: true; compareUrl: string | null }) | { ok: false; error: string };

/**
 * A pull request for the current branch: its commits and change against the remote's default branch (all of
 * them, pushed or not, as the pull request will hold them), the repository's template and recent subjects. On the
 * default branch itself, only the commits not pushed yet. `compareUrl`: GitHub's page for opening it.
 */
export async function pullRequestMaterial(repo: string): Promise<PullRequestMaterial> {
  const current = await read(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [0, 1] });
  const branch = current.ok ? current.stdout.trim() : '';
  if (branch === '') return { ok: false, error: 'Not on a branch' };
  const remote = await config(repo, `branch.${branch}.remote`);
  const merge = (await config(repo, `branch.${branch}.merge`)).replace(/^refs\/heads\//, '');
  if (remote === '' || merge === '') return { ok: false, error: 'The branch has no upstream' };
  const base = await baseOf(repo, remote);
  const baseBranch = base?.slice(remote.length + 1) ?? null;
  const intoBase = base !== null && baseBranch !== merge;
  const range = intoBase ? `${base}..HEAD` : '@{u}..HEAD';
  const count = await countOf(repo, range);
  if (count === 0) return { ok: false, error: 'No commits to describe' };

  const [messages, diff, template, subjects, url] = await Promise.all([
    messagesOf(repo, [range]),
    diffOf(repo, [intoBase ? `${base}...HEAD` : '@{u}...HEAD']),
    templateOf(repo),
    recentSubjects(repo, base ?? 'HEAD'),
    read(repo, ['remote', 'get-url', '--', remote]),
  ]);
  const web = url.ok ? repoWebUrl(url.stdout.trim()) : null;
  const compareUrl = intoBase && web?.label === 'GitHub' ? `${web.url}/compare/${pathOf(baseBranch!)}...${pathOf(merge)}` : null;
  return {
    ok: true,
    about: commitsAbout(count),
    compareUrl,
    text: join(
      intoBase ? `Branch ${branch}, into ${baseBranch}: ${commitsAbout(count)}.` : `Branch ${branch}: the ${commitsAbout(count)} not pushed yet.`,
      block('recent-subjects', subjects),
      block('pull-request-template', template),
      block('commits', messages),
      diff.text,
    ),
  };
}

/** One commit: its message and change. A merge's change is against its first parent, with the commits it brings in. */
export async function commitMaterial(repo: string, oid: string): Promise<Material> {
  const parents = await read(repo, ['rev-list', '--parents', '-n', '1', oid, '--']);
  if (!parents.ok) return { ok: false, error: parents.error };
  const count = parents.stdout.trim().split(' ').length - 1;
  const [message, diff, merged] = await Promise.all([
    read(repo, [...PINNED, 'show', '-s', DATE, COMMIT_FORMAT, oid, '--']),
    diffOf(repo, [count === 0 ? await emptyTree(repo) : `${oid}^1`, oid]),
    count > 1 ? messagesOf(repo, [`${oid}^1..${oid}^2`]) : Promise.resolve(''),
  ]);
  if (!message.ok) return { ok: false, error: message.error };
  const brought = count > 1 ? await countOf(repo, `${oid}^1..${oid}^2`) : 0;
  const files = plural(diff.files, 'file');
  return {
    ok: true,
    about: count > 1 ? `${commitsAbout(brought)}, ${files}` : files,
    text: join(block('commit', message.stdout), block('merged-commits', merged), diff.text),
  };
}

export interface DayRepo {
  path: string;
  name: string;
  oids: string[];
  /** Those of `oids` not pushed yet. */
  unpushed: string[];
}

/** A day's commits, by repository: their messages, tags and the files each changed (no diffs). */
export async function dayMaterial(label: string, repos: DayRepo[]): Promise<Material> {
  const parts: string[] = [];
  let commits = 0;
  for (const repo of repos) {
    if (repo.oids.length === 0) continue;
    const shown = await read(repo.path, [...PINNED, 'show', DATE, COMMIT_FORMAT, '--stat=120,80', '--diff-merges=first-parent', ...repo.oids, '--'], { maxOutput: MAX_READ });
    if (!shown.ok) continue;
    commits += repo.oids.length;
    const unpushed = repo.unpushed.length > 0 ? `Not pushed yet: ${repo.unpushed.map((oid) => oid.slice(0, 7)).join(', ')}\n\n` : '';
    parts.push(block('repository', unpushed + clip(shown.stdout, MAX_DIFF / 2), ` name="${repo.name.replace(/"/g, '')}"`));
  }
  if (commits === 0) return { ok: false, error: 'No commits that day' };
  const count = repos.filter((repo) => repo.oids.length > 0).length;
  return {
    ok: true,
    about: count > 1 ? `${commitsAbout(commits)} in ${count} repositories` : commitsAbout(commits),
    text: join(`The commits of ${label.toLowerCase()}.`, clip(parts.join('\n\n'), MAX_DIFF * 2)),
  };
}
