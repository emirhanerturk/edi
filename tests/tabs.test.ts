import { describe, expect, it } from 'vitest';
import { tabStates } from '../src/main/tabs.js';
import type { PsRow } from '../src/procs.js';

const row = (pid: number, pgid: number, tpgid: number, tty: string, args: string): PsRow => ({ pid, pgid, tpgid, tty, args });
const none = new Set<number>();

describe('tabStates', () => {
  it('önde yalnız kabuk olan sekme kabuğun adını taşır', () => {
    const ps = [row(10, 10, 10, 'ttys001', '-zsh')];
    expect(tabStates([{ id: 1, pid: 10, tty: 'ttys001', shell: '/bin/zsh' }], ps, none)).toEqual([
      { id: 1, title: 'zsh', claude: false, busy: false },
    ]);
  });

  it('önde çalışan komut sekmenin adı olur', () => {
    const ps = [row(10, 10, 20, 'ttys001', '-zsh'), row(20, 20, 20, 'ttys001', 'npm run dev'), row(21, 20, 20, 'ttys001', 'node vite')];
    expect(tabStates([{ id: 1, pid: 10, tty: 'ttys001', shell: '/bin/zsh' }], ps, none)).toEqual([
      { id: 1, title: 'npm run dev', claude: false, busy: true },
    ]);
  });

  it('önde Claude Code olan sekme claude sekmesidir, diğerleri etkilenmez', () => {
    const ps = [
      row(10, 10, 20, 'ttys001', '-zsh'),
      row(20, 20, 20, 'ttys001', 'claude'),
      row(30, 30, 30, 'ttys002', '-zsh'),
    ];
    const ptys = [
      { id: 1, pid: 10, tty: 'ttys001', shell: '/bin/zsh' },
      { id: 2, pid: 30, tty: 'ttys002', shell: '/opt/homebrew/bin/fish' },
    ];
    expect(tabStates(ptys, ps, new Set([20]))).toEqual([
      { id: 1, title: 'claude', claude: true, busy: true },
      { id: 2, title: 'fish', claude: false, busy: false },
    ]);
  });

  it('tty adı bilinmiyorsa kabuğun süreç satırından bulunur', () => {
    const ps = [row(10, 10, 20, 'ttys007', '-zsh'), row(20, 20, 20, 'ttys007', 'vim notlar.md')];
    expect(tabStates([{ id: 1, pid: 10, tty: '', shell: '/bin/zsh' }], ps, none)).toEqual([
      { id: 1, title: 'vim notlar.md', claude: false, busy: true },
    ]);
  });

  it("süreç listesinde izi olmayan sekme kabuğun adını taşır", () => {
    expect(tabStates([{ id: 1, pid: 10, tty: 'ttys001', shell: '/bin/zsh' }], [], none)).toEqual([
      { id: 1, title: 'zsh', claude: false, busy: false },
    ]);
  });
});
