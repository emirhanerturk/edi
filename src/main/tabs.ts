import { basename } from 'node:path';
import { type PsRow, foreground, tabInfo } from '../procs.js';
import type { TabState } from '../shared/api.js';


/** Her sekmenin başlığı ve türü, terminalinde o an önde çalışan sürece göre. */
export function tabStates(
  ptys: { id: number; pid: number; tty: string; shell: string }[],
  ps: PsRow[],
  claudePids: ReadonlySet<number>,
): TabState[] {
  return ptys.map(({ id, pid, tty, shell }) => {
    // tty adı pty'den okunamadıysa kabuğun kendi süreç satırı söyler.
    const terminal = tty || (ps.find((row) => row.pid === pid)?.tty ?? '');
    const fg = terminal === '' ? [] : foreground(ps, terminal);
    return { id, ...tabInfo(fg, pid, basename(shell), claudePids) };
  });
}
