// Runs Claude Code once, non-interactively (`claude -p`), for a summary. The prompt goes in on stdin; the answer
// comes back as Claude Code's JSON result. Claude Code gets no tools: it can only answer from the text it is given.
import { type ChildProcessByStdio, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { childEnv } from '../childEnv.js';

/**
 * Every run: printed JSON, no tools, nothing saved for `--resume`, and none of the MCP servers, skills or
 * hooks of the user's sessions (a hook that plays a sound or posts a notification shouldn't fire for a summary).
 */
export const CLAUDE_ARGS = [
  '-p',
  '--output-format',
  'json',
  '--tools',
  '',
  '--no-session-persistence',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--settings',
  '{"disableAllHooks":true}',
];

/** For a Claude Code too old for one of those flags: the tools that write or run anything are refused instead. */
export const OLDER_ARGS = ['-p', '--output-format', 'json', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task'];

/** A summary that takes longer than this is stopped. */
export const CLAUDE_TIMEOUT_MS = 180_000;
/** The JSON result is small; output past this is not Claude Code's answer. */
const MAX_OUTPUT = 4 * 1_048_576;
/** How long the process gets to exit on its own after SIGTERM. */
const KILL_GRACE_MS = 2000;

export type ClaudeOutcome =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: 'missing' | 'limit' | 'failed' | 'cancelled';
      error: string;
      /** A reset time Claude Code gave with a limit (epoch ms). */
      resetsAt?: number | null;
      /** Claude Code didn't know one of the flags: an older version. */
      unknownOption?: boolean;
    };

export interface ClaudeRunOptions {
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** For tests: the program to run instead of `claude`. */
  command?: string;
  /** For tests: the environment to run it with. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The environment for `claude`: the login shell's (where its PATH is), without the marks of a Claude Code
 * session that edi itself may have been started from, so it doesn't take itself for a nested session.
 */
export function claudeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key === 'CLAUDECODE' || key === 'CLAUDE_CODE_ENTRYPOINT' || key === 'CLAUDE_CODE_SSE_PORT') continue;
    if (key.startsWith('ELECTRON_') || key.startsWith('EDI_') || key.startsWith('VITE_')) continue;
    env[key] = value;
  }
  return env;
}

interface ResultRecord {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
}

const isResult = (value: unknown): value is ResultRecord =>
  typeof value === 'object' && value !== null && (value as ResultRecord).type === 'result';

/**
 * Claude Code's result in `--output-format json` output: one object, or (with `--verbose`) a list of
 * messages ending with it. Null if there is none.
 */
export function parseResult(stdout: string): { isError: boolean; text: string } | null {
  const text = stdout.trim();
  if (text === '') return null;
  const candidates: unknown[] = [];
  try {
    const data: unknown = JSON.parse(text);
    candidates.push(...(Array.isArray(data) ? data : [data]));
  } catch {
    // One JSON value per line.
    for (const line of text.split('\n')) {
      try {
        candidates.push(JSON.parse(line));
      } catch {
        // Not JSON: skipped.
      }
    }
  }
  const result = candidates.reverse().find(isResult);
  if (!result) return null;
  const failed = result.is_error === true || (typeof result.subtype === 'string' && result.subtype !== 'success');
  return { isError: failed, text: typeof result.result === 'string' ? result.result : '' };
}

/** A usage limit's message: "5-hour limit reached ∙ resets 2pm", "You've hit your limit", "Claude AI usage limit reached|1760000000". */
export function isLimitMessage(text: string): boolean {
  return /\blimit\b/i.test(text) && /\b(reach|reached|hit|exceeded|resets?)\b/i.test(text);
}

/** The reset time an older limit message carries after a "|" (epoch seconds); null if none. */
export function resetOf(text: string): number | null {
  const match = /\|(\d{10})\s*$/.exec(text.trim());
  return match ? Number(match[1]) * 1000 : null;
}

/** The most telling line of Claude Code's error output. */
function errorLine(stderr: string): string | null {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.find((line) => /^error:/i.test(line)) ?? lines.at(-1) ?? null;
}

/** What a finished process said: its answer, or why there is none. */
export function outcomeOf(code: number | null, stdout: string, stderr: string): ClaudeOutcome {
  const result = parseResult(stdout);
  if (result && !result.isError) return { ok: true, text: result.text };
  if (result && result.text.trim() !== '') {
    const message = result.text.trim();
    if (isLimitMessage(message)) return { ok: false, reason: 'limit', error: message.replace(/\|\d{10}\s*$/, ''), resetsAt: resetOf(message) };
    return { ok: false, reason: 'failed', error: message };
  }
  const line = errorLine(stderr);
  if (line !== null && /unknown option/i.test(line)) return { ok: false, reason: 'failed', error: line, unknownOption: true };
  if (line !== null && isLimitMessage(line)) return { ok: false, reason: 'limit', error: line, resetsAt: resetOf(line) };
  return { ok: false, reason: 'failed', error: line ?? (code === 0 ? 'Claude Code gave no answer' : `Claude Code stopped (exit code ${code ?? 'unknown'})`) };
}

/** One run with the given flags. Never rejects. */
export function runClaude(opts: ClaudeRunOptions & { args: string[] }): Promise<ClaudeOutcome> {
  const { cwd, prompt, signal, timeoutMs = CLAUDE_TIMEOUT_MS, command = 'claude', args } = opts;
  if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'cancelled', error: 'Cancelled' });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let stopped: ClaudeOutcome | null = null;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (outcome: ClaudeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    let child: ChildProcessByStdio<Writable, Readable, Readable>;
    try {
      // In its own process group, so stopping it stops what it started too. The command is looked up in the
      // environment's PATH: the login shell's, as in the terminals.
      child = spawn(command, args, { cwd, env: opts.env ?? claudeEnv(childEnv()), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ ok: false, reason: 'failed', error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, sig);
      } catch {
        // Already finished.
      }
    };
    const stop = (outcome: ClaudeOutcome) => {
      if (stopped || settled) return;
      stopped = outcome;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
        finish(outcome);
      }, KILL_GRACE_MS);
    };
    function onAbort() {
      stop({ ok: false, reason: 'cancelled', error: 'Cancelled' });
    }
    signal?.addEventListener('abort', onAbort);
    timer = setTimeout(() => stop({ ok: false, reason: 'failed', error: 'Claude Code took too long and was stopped' }), timeoutMs);

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(
        err.code === 'ENOENT'
          ? { ok: false, reason: 'missing', error: "Claude Code isn't installed, or edi can't find it" }
          : { ok: false, reason: 'failed', error: err.message },
      );
    });
    // Claude Code may exit before reading everything (a flag it doesn't know): a broken pipe isn't an error of its own.
    child.stdin.on('error', () => undefined);
    child.stdin.end(prompt);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) stop({ ok: false, reason: 'failed', error: 'Claude Code wrote more than expected' });
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on('close', (code) => finish(stopped ?? outcomeOf(code, stdout, stderr)));
  });
}

/** A run with every flag, and once more with fewer if this Claude Code is too old for one of them. */
export async function askClaude(opts: ClaudeRunOptions): Promise<ClaudeOutcome> {
  const outcome = await runClaude({ ...opts, args: CLAUDE_ARGS });
  if (outcome.ok || !outcome.unknownOption) return outcome;
  return runClaude({ ...opts, args: OLDER_ARGS });
}
