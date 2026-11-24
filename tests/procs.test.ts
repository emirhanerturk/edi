import { describe, expect, it } from 'vitest';
import { type PsRow, foreground, listPs, parsePs, tabInfo } from '../src/procs.js';

const row = (pid: number, pgid: number, tpgid: number, tty: string, args: string): PsRow => ({ pid, pgid, tpgid, tty, args });

describe('parsePs', () => {
  it('sütunları ve boşluklu komut satırını okur', () => {
    const out = [
      '    1     1     0 ??       /sbin/launchd',
      '39840 39840 50792 ttys001  /bin/zsh -il',
      '50792 50792 50792 ttys001  claude',
      '',
      '  612   612   612 ttys004  npm run dev  --host',
    ].join('\n');
    expect(parsePs(out)).toEqual([
      row(1, 1, 0, '', '/sbin/launchd'),
      row(39840, 39840, 50792, 'ttys001', '/bin/zsh -il'),
      row(50792, 50792, 50792, 'ttys001', 'claude'),
      row(612, 612, 612, 'ttys004', 'npm run dev  --host'),
    ]);
  });

  it('bozuk satırları atlar', () => {
    expect(parsePs('PID PGID\nabc def\n')).toEqual([]);
  });
});

describe('foreground', () => {
  it("yalnız o tty'nin ön plandaki süreç grubunu verir", () => {
    const rows = [
      row(10, 10, 20, 'ttys001', '-zsh'),
      row(20, 20, 20, 'ttys001', 'npm run dev'),
      row(21, 20, 20, 'ttys001', 'node vite'),
      row(30, 30, 30, 'ttys002', 'vim'),
      row(40, 40, 0, '', 'daemon'),
    ];
    expect(foreground(rows, 'ttys001').map((r) => r.pid)).toEqual([20, 21]);
    expect(foreground(rows, 'ttys009')).toEqual([]);
  });
});

describe('tabInfo', () => {
  const none = new Set<number>();

  it('önde yalnız kabuk varsa kabuğun adını verir, meşgul değildir', () => {
    expect(tabInfo([row(10, 10, 10, 'ttys001', '-zsh')], 10, 'zsh', none)).toEqual({ title: 'zsh', claude: false, busy: false });
    expect(tabInfo([], 10, 'zsh', none)).toEqual({ title: 'zsh', claude: false, busy: false });
  });

  it('öndeki komutun adını yolundan arındırır ve meşgul sayar', () => {
    const fg = [row(21, 20, 20, 'ttys001', 'node worker'), row(20, 20, 20, 'ttys001', '/opt/homebrew/bin/node /x/npm run dev')];
    expect(tabInfo(fg, 10, 'zsh', none)).toEqual({ title: 'node /x/npm run dev', claude: false, busy: true });
  });

  it('uzun komutu 40 karakterde keser', () => {
    const info = tabInfo([row(20, 20, 20, 'ttys001', `sleep ${'9'.repeat(80)}`)], 10, 'zsh', none);
    expect(info.title).toHaveLength(40);
    expect(info.title.startsWith('sleep 999')).toBe(true);
  });

  it('önde Claude Code varsa claude sekmesidir', () => {
    const fg = [row(20, 20, 20, 'ttys001', '/Users/x/.local/share/claude/versions/2.1.331'), row(22, 20, 20, 'ttys001', 'node mcp')];
    expect(tabInfo(fg, 10, 'zsh', new Set([20]))).toEqual({ title: 'claude', claude: true, busy: true });
  });
});

describe('listPs', () => {
  it('bu sürecin kendisini içerir', async () => {
    const rows = await listPs();
    expect(rows.some((r) => r.pid === process.pid)).toBe(true);
  });
});
