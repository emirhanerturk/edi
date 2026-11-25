import { type RunGitOptions, runGit } from './exec.js';
import { type FileChange, type RepoStatus, getStatus, isStaged } from './status.js';
import type { BranchList } from './types.js';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
export type DiffResult = { ok: true; text: string } | { ok: false; error: string };

/** git's empty tree object: the diff base in a repo with no commits yet. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** Local commands that change the index or the working tree (a large initial `add` can take a while). */
export const LOCAL_WRITE_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 120_000;
/**
 * Commands that can run hooks or update the working tree: pre-commit / pre-push
 * hooks may run tests, and an interrupted pull leaves the tree half-updated. Hence the long timeout.
 */
const SLOW_TIMEOUT_MS = 600_000;
export const CONFLICT_ERROR = 'Conflicted files present; resolve them outside edi';

/**
 * Matches the path literally, not as a glob. Paths like `app/[slug]/page.tsx`
 * would also match other files if interpreted as a pathspec.
 */
const literal = (path: string) => `:(literal)${path}`;
/** Color, external diff tools and path quoting are off: the output is plain, readable text under any config. */
const DIFF_ARGS = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff'];

async function act(repo: string, args: string[], message: string, opts?: RunGitOptions): Promise<ActionResult> {
  const result = await runGit(repo, args, opts);
  return result.ok ? { ok: true, message } : { ok: false, error: overwriteError(result.stderr ?? '') ?? result.error };
}

/** "a, b, c and 2 more". */
export const fileList = (paths: string[]) => (paths.length <= 3 ? paths.join(', ') : `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`);

/** The first line of git's output matching `heading`, and the tab-indented file list git prints under it. */
export function listedUnder(output: string, heading: RegExp): { line: string; files: string[] } | null {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const files: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break;
    files.push(line.trim());
  }
  return files.length === 0 ? null : { line: lines[start]!, files };
}

/**
 * A switch or pull refused because local changes would be overwritten, in one line with the files git
 * lists under it ("Your local changes to README.md would be overwritten by checkout"); null otherwise.
 */
export function overwriteError(stderr: string): string | null {
  const refused = listedUnder(stderr, /would be overwritten by (checkout|merge):\s*$/);
  if (!refused) return null;
  const by = /by checkout/.test(refused.line) ? 'checkout' : 'merge';
  const { files } = refused;
  if (/untracked working tree files/.test(refused.line)) {
    return `The untracked ${files.length === 1 ? 'file' : 'files'} ${fileList(files)} would be overwritten by ${by}`;
  }
  return `Your local changes to ${fileList(files)} would be overwritten by ${by}`;
}

export function stageFile(repo: string, f: FileChange): Promise<ActionResult> {
  return act(repo, ['add', '-A', '--', literal(f.path)], 'Staged', { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
}

/** Touches only the index; the content in the working tree doesn't change. */
export function unstageFile(repo: string, f: FileChange): Promise<ActionResult> {
  const paths = f.origPath === null ? [f.path] : [f.path, f.origPath];
  return act(repo, ['reset', '-q', '--', ...paths.map(literal)], 'Unstaged', {
    timeoutMs: LOCAL_WRITE_TIMEOUT_MS,
  });
}

/**
 * Refuses while there are conflicted files: `git add` marks the conflict as "resolved" and
 * the conflict markers end up in the commit. Resolving conflicts is outside edi's scope.
 */
export async function stageAll(repo: string): Promise<ActionResult> {
  const current = await getStatus(repo);
  if (!current.ok) return { ok: false, error: current.error };
  if (current.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  return act(repo, ['add', '-A'], 'Staged', { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
}

/**
 * Touches only the index; the content in the working tree doesn't change. Refuses while there are conflicted files:
 * resetting the index also erases the conflict entries, so the file looks like an ordinary change and
 * becomes committable with the conflict markers still in it.
 */
export async function unstageAll(repo: string): Promise<ActionResult> {
  const current = await getStatus(repo);
  if (!current.ok) return { ok: false, error: current.error };
  if (current.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  return resetIndex(repo);
}

function resetIndex(repo: string): Promise<ActionResult> {
  // Without a path, `git reset` also clears an in-progress merge/cherry-pick (MERGE_HEAD);
  // with `-- .` only the index is reset.
  return act(repo, ['reset', '-q', '--', '.'], 'Unstaged', { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
}

export async function commit(repo: string, message: string, opts: { addAll: boolean }): Promise<ActionResult> {
  const trimmed = message.trim();
  if (trimmed === '') return { ok: false, error: 'Commit message is empty' };
  if (!opts.addAll) return act(repo, ['commit', '-m', trimmed], 'Committed', { timeoutMs: SLOW_TIMEOUT_MS });

  // Same conflict check as stageAll; it also captures the index's initial state.
  const before = await getStatus(repo);
  if (!before.ok) return { ok: false, error: before.error };
  if (before.status.files.some((f) => f.kind === 'conflicted')) return { ok: false, error: CONFLICT_ERROR };
  const nothingStaged = !before.status.files.some(isStaged);

  const added = await act(repo, ['add', '-A'], 'Staged', { timeoutMs: LOCAL_WRITE_TIMEOUT_MS });
  if (!added.ok) return added;
  const committed = await act(repo, ['commit', '-m', trimmed], 'Committed', { timeoutMs: SLOW_TIMEOUT_MS });
  // If the commit was rejected (hook, empty commit) and nothing was staged at the start, the index is
  // restored. Otherwise everything would stay staged; when the user fixed the file and retried, the old
  // content in the index would be committed instead of the fix.
  if (!committed.ok && nothingStaged) await resetIndex(repo);
  return committed;
}

export function push(repo: string, status: RepoStatus): Promise<ActionResult> {
  if (status.detached) return Promise.resolve({ ok: false, error: 'Detached HEAD: cannot push' });
  // Full ref name: the short name is ambiguous if a tag with the same name exists.
  const args = status.upstream === null ? ['push', '-u', 'origin', `refs/heads/${status.head}`] : ['push'];
  return act(repo, args, 'Pushed', { timeoutMs: SLOW_TIMEOUT_MS });
}

export function pull(repo: string): Promise<ActionResult> {
  return act(repo, ['pull', '--ff-only'], 'Pulled', { timeoutMs: SLOW_TIMEOUT_MS });
}

export function fetchRepo(repo: string): Promise<ActionResult> {
  return act(repo, ['fetch'], 'Fetched', { timeoutMs: FETCH_TIMEOUT_MS });
}

/** A fetch nobody asked for gives up sooner: the next round tries again. */
const BACKGROUND_FETCH_TIMEOUT_MS = 60_000;
/**
 * Nothing may ask for a password behind the user's back: no credential manager window
 * (`GCM_INTERACTIVE`), no askpass program for git or ssh. A remote that needs one fails instead.
 */
export const NO_PROMPTS: Record<string, string> = { GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never' };

/** The automatic fetch: quiet, with no prompt and a shorter timeout than the Fetch button's. */
export function fetchInBackground(repo: string): Promise<ActionResult> {
  return act(repo, ['fetch', '--quiet'], 'Fetched', { timeoutMs: BACKGROUND_FETCH_TIMEOUT_MS, env: NO_PROMPTS });
}

export async function listBranches(repo: string): Promise<BranchList> {
  // Name, "ahead 1, behind 2" (empty when in sync or without an upstream, "gone" if it was deleted) and date.
  // Reads only local refs: the counts are as of the last fetch.
  const refs = await runGit(repo, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:lstrip=2)%00%(upstream:track,nobracket)%00%(committerdate:unix)',
    'refs/heads',
  ]);
  if (!refs.ok) return { ok: false, error: refs.error };
  // Exits with 1 on a detached HEAD; that isn't an error, it means "no current branch".
  const currentRef = await runGit(repo, ['symbolic-ref', '-q', 'HEAD'], { okCodes: [0, 1] });
  if (!currentRef.ok) return { ok: false, error: currentRef.error };
  return {
    ok: true,
    branches: refs.stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [name = '', track = '', date = '0'] = line.split('\0');
        return {
          name,
          ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
          behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
          updatedAt: Number(date) * 1000,
        };
      }),
    current: currentRef.stdout.trim().replace(/^refs\/heads\//, '') || null,
  };
}

/** A name starting with `-` would reach git as an option (like `--detach`); an empty name is invalid too. */
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

function untrackedDiff(repo: string, path: string, maxOutput: number) {
  // --no-index exits with 1 when it finds differences.
  return runGit(repo, [...DIFF_ARGS, '--no-index', '--', '/dev/null', path], { okCodes: [0, 1], maxOutput });
}

/**
 * The file's full change against HEAD (staged + unstaged); for a new file, all of it as additions.
 * Returns an `OUTPUT_TOO_LARGE` error if the output exceeds `maxOutput` characters.
 */
export async function diffFile(repo: string, status: RepoStatus, f: FileChange, maxOutput = Infinity): Promise<DiffResult> {
  const paths = f.origPath === null ? [f.path] : [f.path, f.origPath];
  const result =
    f.kind === 'untracked'
      ? await untrackedDiff(repo, f.path, maxOutput)
      : await runGit(repo, [...DIFF_ARGS, '-M', diffBase(status), '--', ...paths.map(literal)], { maxOutput });
  return result.ok ? { ok: true, text: result.stdout } : { ok: false, error: result.error };
}
