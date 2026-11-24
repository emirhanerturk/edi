import * as pty from 'node-pty';

/**
 * Kabuğa geçen ortam. Bu uygulamanın ve (uygulama bir Claude Code oturumundan başlatıldıysa)
 * o oturumun izleri silinir: sekmede açılan Claude Code kendini iç içe oturum sanmasın.
 * Kullanıcının kendi ayarları (ör. CLAUDE_CONFIG_DIR) olduğu gibi kalır.
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
  /** Kabuğun süreç kimliği. */
  pid: number;
  /** `ttys003` gibi; okunamadıysa boş. */
  tty: string;
  /** Kabuğun yolu. */
  shell: string;
}

const clampCols = (cols: number) => (Number.isFinite(cols) ? Math.max(2, Math.floor(cols)) : 80);
const clampRows = (rows: number) => (Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 24);

/** Sekmelerin arkasındaki gerçek terminaller. */
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

  /** Giriş kabuğu açar (`-l`): kullanıcının profili, PATH'i ve takma adları kendi terminalindekiyle aynı olur. */
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
      // killAll ile kapatılanlar haritadan önceden çıkarılır; onlar için bildirim gitmez.
      if (this.ptys.get(id) !== proc) return;
      this.ptys.delete(id);
      this.onExit(id);
    });
    // Komut kabuğun içinde çalışır: bitince (ör. Claude Code'dan çıkınca) kabuk açık kalır.
    if (o.command) proc.write(`${o.command}\r`);
    return id;
  }

  write(id: number, data: string): void {
    try {
      this.ptys.get(id)?.write(data);
    } catch {
      // Kapanmakta olan pty.
    }
  }

  resize(id: number, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.resize(clampCols(cols), clampRows(rows));
    } catch {
      // Kapanmakta olan pty.
    }
  }

  kill(id: number): void {
    try {
      this.ptys.get(id)?.kill();
    } catch {
      // Zaten bitmiş.
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
        // Zaten bitmiş.
      }
    }
  }
}
