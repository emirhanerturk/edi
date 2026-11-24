import { type ChildProcessByStdio, spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';

export type GitResult = { ok: true; stdout: string } | { ok: false; error: string; stdout: string };

export interface RunGitOptions {
  /** Defaults to 15000. If exceeded, the process group is terminated. */
  timeoutMs?: number;
  /** Exit codes that count as success. Defaults to [0]. */
  okCodes?: number[];
  /** If the output exceeds this many characters, reading stops, the process is terminated and `OUTPUT_TOO_LARGE` is returned. */
  maxOutput?: number;
  /** Extra environment variables (e.g. `GIT_NO_LAZY_FETCH`). */
  env?: Record<string, string>;
  /** Written to git's stdin (e.g. `blame --contents -`); without it stdin is closed. */
  input?: string;
}

export const OUTPUT_TOO_LARGE = 'Output too large';

/** How long the process gets to exit on its own after SIGTERM. */
const KILL_GRACE_MS = 2000;
/** How long to wait for the output pipes to close after git exits. */
const CLOSE_GRACE_MS = 200;

/** Environment variables that could redirect the command to a repo other than `cwd`. */
const REDIRECTING_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_NAMESPACE',
];

function gitEnv(cwd: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Fixed locale: picking the error line and the UI text rely on git's English output.
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANG: 'C' };
  for (const name of REDIRECTING_VARS) delete env[name];
  // If `cwd` isn't a repo, git searches the parent folders for one. The ceiling keeps a row's
  // command from accidentally running in another repo further up.
  env.GIT_CEILING_DIRECTORIES = [dirname(cwd), process.env.GIT_CEILING_DIRECTORIES].filter(Boolean).join(':');
  return env;
}

/**
 * Runs git with an argument array; never rejects.
 *
 * `detached` detaches the process from the controlling terminal: git or ssh can't take over
 * the terminal to ask for a password, so they fail instead of asking.
 */
export async function runGit(cwd: string, args: string[], opts: RunGitOptions = {}): Promise<GitResult> {
  const { timeoutMs = 15000, okCodes = [0], maxOutput = Infinity, env: extraEnv, input } = opts;

  // With a missing cwd, spawn reports "spawn git ENOENT", which reads as if git weren't installed.
  const isDir = await stat(cwd).then((s) => s.isDirectory(), () => false);
  if (!isDir) return { ok: false, error: 'Repository folder not found', stdout: '' };

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let closeTimer: NodeJS.Timeout | undefined;

    const finish = (result: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(closeTimer);
      resolve(result);
    };

    let child: ChildProcessByStdio<Writable | null, Readable, Readable>;
    try {
      child = spawn('git', args, { cwd, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: gitEnv(cwd, extraEnv) }) as ChildProcessByStdio<
        Writable | null,
        Readable,
        Readable
      >;
      if (input !== undefined && child.stdin) {
        // git may exit before reading everything (an error): a broken pipe isn't an error of its own.
        child.stdin.on('error', () => undefined);
        child.stdin.end(input);
      }
    } catch (err) {
      // E.g. an argument containing NUL: spawn throws synchronously.
      finish({ ok: false, error: err instanceof Error ? err.message : String(err), stdout: '' });
      return;
    }

    // Negative pid: the whole group, including child processes git started (hooks, ssh).
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // The process has already finished.
      }
    };

    timer = setTimeout(() => {
      timedOut = true;
      // SIGTERM first: git cleans up its lock files (index.lock) before exiting.
      // SIGKILL leaves the lock behind and every later write in the repo gets locked out.
      killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
        finish({ ok: false, error: 'Timed out', stdout });
      }, KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (settled) return;
      stdout += chunk;
      if (stdout.length > maxOutput) {
        // Don't let it grow in memory: stop reading. SIGTERM lets git clean up its locks before exiting.
        killGroup('SIGTERM');
        finish({ ok: false, error: OUTPUT_TOO_LARGE, stdout: '' });
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => finish({ ok: false, error: err.message, stdout }));
    const settle = (code: number | null) => {
      if (timedOut) finish({ ok: false, error: 'Timed out', stdout });
      else if (code !== null && okCodes.includes(code)) finish({ ok: true, stdout });
      // Some git errors (like "nothing to commit") are written to stdout, not stderr.
      else finish({ ok: false, error: pickErrorLine(stderr.trim() === '' ? stdout : stderr), stdout });
    };
    child.on('close', settle);
    // If a hook leaves a process in the background, the pipes stay open and 'close' doesn't fire until it ends.
    // Once git itself has exited the work is done: wait briefly for any remaining output, then settle.
    child.on('exit', (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      closeTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle(code);
      }, CLOSE_GRACE_MS);
    });
  });
}

/** Picks the most informative line of git's error output to show on a single line. */
export function pickErrorLine(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const telling = lines.find((line) => /^(fatal|error):/.test(line) || line.includes('[rejected]'));
  return telling ?? lines.at(-1) ?? 'git failed';
}
