import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import type { PsRow } from './procs.js';
import { parseLsofPidCwd } from './sessions.js';
import type { ServerInfo } from './shared/api.js';

/** Returns stdout whatever the exit code (lsof exits with 1 when nothing matches). */
export type Run = (cmd: string, args: string[]) => Promise<string>;

const run: Run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''));
  });

/** A listen address reachable from localhost: all addresses or loopback. */
function reachable(host: string): boolean {
  return host === '*' || host === '0.0.0.0' || host === '[::]' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * Start of the range macOS assigns at random to callers of `listen(0)`. Ports in this range
 * are internal ports nobody typed (Claude Code, vite plugins, workerd); they don't count as servers.
 */
export const EPHEMERAL_FIRST = 49152;

/** `lsof -Fpn` output: pid → ports reachable from localhost and not randomly assigned (sorted, unique). */
export function parseListening(out: string): Map<number, number[]> {
  const ports = new Map<number, Set<number>>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      pid = /^\d+$/.test(line.slice(1)) ? Number(line.slice(1)) : null;
      continue;
    }
    if (!line.startsWith('n') || pid === null) continue;
    const match = /^(.*):(\d+)$/.exec(line.slice(1));
    if (!match || !reachable(match[1]!)) continue;
    const port = Number(match[2]);
    if (port < 1 || port >= EPHEMERAL_FIRST) continue;
    if (!ports.has(pid)) ports.set(pid, new Set());
    ports.get(pid)!.add(port);
  }
  return new Map([...ports].map(([key, set]) => [key, [...set].sort((a, b) => a - b)]));
}

/** Claude Code itself: it opens its own internal port and is not a server. The child processes it starts do count. */
const isClaude = (args: string) => basename(args.split(' ')[0] ?? '') === 'claude';

/**
 * Processes running on the tty of an edi terminal that are neither the shell nor Claude Code: pid → tab.
 * Background ones (`&`) count too.
 */
export function serverCandidates(ptys: { id: number; pid: number; tty: string }[], ps: PsRow[]): Map<number, number> {
  const tabByTty = new Map<string, number>();
  const shells = new Set<number>();
  for (const { id, pid, tty } of ptys) {
    // If the tty name couldn't be read from the pty, the shell's own process row tells us.
    const terminal = tty || (ps.find((row) => row.pid === pid)?.tty ?? '');
    if (terminal !== '') tabByTty.set(terminal, id);
    shells.add(pid);
  }
  const candidates = new Map<number, number>();
  for (const row of ps) {
    const tab = tabByTty.get(row.tty);
    if (tab !== undefined && !shells.has(row.pid) && !isClaude(row.args)) candidates.set(row.pid, tab);
  }
  return candidates;
}

/** The server list from the ports the candidates listen on: in port order, each port once per tab. */
export function serversFor(candidates: Map<number, number>, listening: Map<number, number[]>, cwds: Map<number, string>): ServerInfo[] {
  const servers = new Map<string, ServerInfo>();
  for (const [pid, ports] of [...listening].sort(([a], [b]) => a - b)) {
    const tabId = candidates.get(pid);
    if (tabId === undefined) continue;
    for (const port of ports) {
      const key = `${tabId}:${port}`;
      if (!servers.has(key)) servers.set(key, { tabId, port, pid, cwd: cwds.get(pid) ?? null });
    }
  }
  return [...servers.values()].sort((a, b) => a.port - b.port || a.tabId - b.tabId);
}

/** TCP ports the given processes listen on. */
export async function readListening(pids: number[], exec: Run = run): Promise<Map<number, number[]>> {
  return parseListening(await exec('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', pids.join(','), '-Fpn']));
}

/**
 * Localhost ports opened for listening in edi terminals. If there are no non-shell processes, lsof
 * isn't run. An empty list if they can't be read: the list is a convenience, and its errors don't concern the user.
 */
export async function listServers(ptys: { id: number; pid: number; tty: string }[], ps: PsRow[], exec: Run = run): Promise<ServerInfo[]> {
  const candidates = serverCandidates(ptys, ps);
  if (candidates.size === 0) return [];
  try {
    const listening = await readListening([...candidates.keys()], exec);
    const pids = [...listening.keys()].filter((pid) => candidates.has(pid));
    if (pids.length === 0) return [];
    const cwds = parseLsofPidCwd(await exec('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn']));
    return serversFor(candidates, listening, cwds);
  } catch {
    return [];
  }
}
