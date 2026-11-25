import { execFile } from 'node:child_process';
import { sep } from 'node:path';
import type { Repo } from './git/discover.js';
import type { PsRow } from './procs.js';

/** Returns stdout whatever the exit code; empty text if the command can't run at all. */
function output(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''));
  });
}

/** Extracts each process's working directory from `lsof -Fpn` output (a 'p' line is the pid, an 'n' line the path). */
export function parseLsofPidCwd(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** Running Claude Code processes. An empty array if they can't be detected. */
export async function listClaudePids(): Promise<number[]> {
  // pgrep exits with 1 when nothing matches; stdout is still valid. macOS pgrep leaves out its
  // own ancestors unless given -a, which would hide the Claude that edi was started from.
  return (await output('pgrep', ['-a', '-x', 'claude']))
    .split('\n')
    .filter((pid) => /^\d+$/.test(pid))
    .map(Number);
}

export interface ClaudeSession {
  pid: number;
  cwd: string;
  tty: string;
}

/**
 * Only sessions running in a terminal count: those without one (e.g. run in the background
 * by an editor) are processes the user can't see.
 */
export function joinSessions(pids: number[], cwdByPid: ReadonlyMap<number, string>, ps: PsRow[]): ClaudeSession[] {
  const ttyByPid = new Map(ps.map((row) => [row.pid, row.tty]));
  const sessions: ClaudeSession[] = [];
  for (const pid of pids) {
    const cwd = cwdByPid.get(pid);
    const tty = ttyByPid.get(pid);
    if (cwd && tty) sessions.push({ pid, cwd, tty });
  }
  return sessions;
}

/**
 * Claude Code sessions open in a terminal. An empty array if they can't be detected:
 * the indicator is a convenience, and its errors don't concern the user.
 */
export async function listClaudeSessions(ps: PsRow[], pids: number[]): Promise<ClaudeSession[]> {
  const withTty = joinSessions(pids, new Map(pids.map((pid) => [pid, '-'])), ps).map((session) => session.pid);
  if (withTty.length === 0) return [];
  // lsof exits with 1 if one of the listed processes has exited in the meantime; stdout is still valid.
  const cwds = parseLsofPidCwd(await output('lsof', ['-a', '-d', 'cwd', '-p', withTty.join(','), '-Fpn']));
  return joinSessions(withTty, cwds, ps);
}

const isInside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

/**
 * Counts each session under the repo it is in; if it is in no repo but inside the scanned folder, under the root.
 * Paths are compared on segment boundaries: `quizei-app-next-quiz` doesn't count as inside `quizei-app`.
 */
export function assignSessions(
  cwds: string[],
  dir: string,
  repos: Repo[],
): { root: number; byRepo: Record<string, number> } {
  const byRepo: Record<string, number> = {};
  let root = 0;
  for (const cwd of cwds) {
    const repo = repos.find((candidate) => isInside(cwd, candidate.path));
    if (repo) byRepo[repo.path] = (byRepo[repo.path] ?? 0) + 1;
    else if (isInside(cwd, dir)) root++;
  }
  return { root, byRepo };
}
