import { execFile } from 'node:child_process';
import { basename } from 'node:path';

export interface PsRow {
  pid: number;
  /** Süreç grubu. */
  pgid: number;
  /** Sürecin terminalinde o an önde olan süreç grubu; terminali yoksa 0. */
  tpgid: number;
  /** `ttys003` gibi; terminali yoksa boş. */
  tty: string;
  args: string;
}

/** `ps -axww -o pid=,pgid=,tpgid=,tty=,args=` çıktısını ayrıştırır. */
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

/** Çalışan tüm süreçler. Okunamazsa boş dizi: sekme adı bir kolaylık, hatası kullanıcıyı ilgilendirmez. */
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

/** Bir terminalde o an önde çalışan süreç grubunun üyeleri. */
export function foreground(rows: PsRow[], tty: string): PsRow[] {
  return rows.filter((row) => row.tty === tty && row.pgid === row.tpgid);
}

export interface TabInfo {
  title: string;
  claude: boolean;
  /** Kabuğun dışında bir şey çalışıyor: sekme kapatılırken sorulur. */
  busy: boolean;
}

const TITLE_MAX = 40;

/** Sekmenin başlığı ve türü, terminalinde önde çalışan süreç grubuna göre. */
export function tabInfo(fg: PsRow[], shellPid: number, shellName: string, claudePids: ReadonlySet<number>): TabInfo {
  if (fg.some((row) => claudePids.has(row.pid))) return { title: 'claude', claude: true, busy: true };

  const others = fg.filter((row) => row.pid !== shellPid);
  if (others.length === 0) return { title: shellName, claude: false, busy: false };

  // Grubun lideri kullanıcının yazdığı komuttur; diğerleri onun alt süreçleri.
  const leader = others.find((row) => row.pid === row.pgid) ?? others[0]!;
  const [command = '', ...rest] = leader.args.split(' ');
  const title = [basename(command), ...rest].join(' ').slice(0, TITLE_MAX);
  return { title, claude: false, busy: true };
}
