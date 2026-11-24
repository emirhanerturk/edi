import { execFile } from 'node:child_process';
import { basename } from 'node:path';

export interface PsRow {
  pid: number;
  /** Process group. */
  pgid: number;
  /** The process group currently in the foreground of the process's terminal; 0 if it has no terminal. */
  tpgid: number;
  /** Like `ttys003`; empty if it has no terminal. */
  tty: string;
  args: string;
}

/** Parses the output of `ps -axww -o pid=,pgid=,tpgid=,tty=,args=`. */
export function parsePs(out: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      pgid: Number(match[2]),
      tpgid: Number(match[3]),
      tty: match[4] === '??' || match[4] === '-' ? '' : (match[4] ?? ''),
      args: match[5] ?? '',
    });
  }
  return rows;
}

/** All running processes. An empty array if they can't be read: the tab name is a convenience, and its errors don't concern the user. */
export function listPs(): Promise<PsRow[]> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-axww', '-o', 'pid=,pgid=,tpgid=,tty=,args='],
      { timeout: 5000, maxBuffer: 16 * 1024 * 1024 },
      (_error, stdout) => resolve(typeof stdout === 'string' ? parsePs(stdout) : []),
    );
  });
}

/** Members of the process group currently in the foreground of a terminal. */
export function foreground(rows: PsRow[], tty: string): PsRow[] {
  return rows.filter((row) => row.tty === tty && row.pgid === row.tpgid);
}

export interface TabInfo {
  title: string;
  claude: boolean;
  /** Something other than the shell is running: closing the tab asks first. */
  busy: boolean;
}

const TITLE_MAX = 40;

/** The tab's title and kind, based on the foreground process group in its terminal. */
export function tabInfo(fg: PsRow[], shellPid: number, shellName: string, claudePids: ReadonlySet<number>): TabInfo {
  if (fg.some((row) => claudePids.has(row.pid))) return { title: 'claude', claude: true, busy: true };

  const others = fg.filter((row) => row.pid !== shellPid);
  if (others.length === 0) return { title: shellName, claude: false, busy: false };

  // The group leader is the command the user typed; the others are its child processes.
  const leader = others.find((row) => row.pid === row.pgid) ?? others[0]!;
  const [command = '', ...rest] = leader.args.split(' ');
  const title = [basename(command), ...rest].join(' ').slice(0, TITLE_MAX);
  return { title, claude: false, busy: true };
}
