import * as pty from 'node-pty';

/**
 * The environment passed to the shell. Traces of this app and (if the app was started from a Claude Code session)
 * of that session are removed, so Claude Code opened in a tab doesn't think it is a nested session.
 * The user's own settings (e.g. CLAUDE_CONFIG_DIR) are left as they are.
 */
export function shellEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) continue;
    if (key.startsWith('ELECTRON_') || key.startsWith('EDI_') || key.startsWith('VITE_')) continue;
    env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'edi';
  return env;
}

export interface PtyInfo {
  /** The shell's process id. */
  pid: number;
  /** Like `ttys003`; empty if it couldn't be read. */
  tty: string;
  /** The shell's path. */
  shell: string;
}

const clampCols = (cols: number) => (Number.isFinite(cols) ? Math.max(2, Math.floor(cols)) : 80);
const clampRows = (rows: number) => (Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 24);

/** The real terminals behind the tabs. */
export class PtyManager {
  private readonly ptys = new Map<number, pty.IPty>();
  private nextId = 1;
  private readonly shell: string;
  private readonly onData: (id: number, data: string) => void;
  private readonly onExit: (id: number) => void;

  constructor(opts: { shell?: string; onData: (id: number, data: string) => void; onExit: (id: number) => void }) {
    this.shell = opts.shell ?? process.env.SHELL ?? '/bin/zsh';
    this.onData = opts.onData;
    this.onExit = opts.onExit;
  }

  /** Opens a login shell (`-l`): the user's profile, PATH and aliases match those in their own terminal. */
  create(o: { cols: number; rows: number; cwd: string; command?: string }): number {
    const id = this.nextId++;
    const proc = pty.spawn(this.shell, ['-l'], {
      name: 'xterm-256color',
      cols: clampCols(o.cols),
      rows: clampRows(o.rows),
      cwd: o.cwd,
      env: shellEnv(process.env),
    });
    this.ptys.set(id, proc);
    proc.onData((data) => {
      if (this.ptys.get(id) === proc) this.onData(id, data);
    });
    proc.onExit(() => {
      // Those closed by killAll are removed from the map beforehand; no notification goes out for them.
      if (this.ptys.get(id) !== proc) return;
      this.ptys.delete(id);
      this.onExit(id);
    });
    // The command runs inside the shell: when it ends (e.g. on exiting Claude Code), the shell stays open.
    if (o.command) proc.write(`${o.command}\r`);
    return id;
  }

  write(id: number, data: string): void {
    try {
      this.ptys.get(id)?.write(data);
    } catch {
      // The pty is closing.
    }
  }

  resize(id: number, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.resize(clampCols(cols), clampRows(rows));
    } catch {
      // The pty is closing.
    }
  }

  kill(id: number): void {
    try {
      this.ptys.get(id)?.kill();
    } catch {
      // Already finished.
    }
  }

  info(id: number): PtyInfo | null {
    const proc = this.ptys.get(id);
    if (!proc) return null;
    const name = (proc as unknown as { ptsName?: unknown }).ptsName;
    const tty = typeof name === 'string' ? name.replace(/^\/dev\//, '') : '';
    return { pid: proc.pid, tty, shell: this.shell };
  }

  ids(): number[] {
    return [...this.ptys.keys()];
  }

  killAll(): void {
    const all = [...this.ptys.values()];
    this.ptys.clear();
    for (const proc of all) {
      try {
        proc.kill();
      } catch {
        // Already finished.
      }
    }
  }
}
