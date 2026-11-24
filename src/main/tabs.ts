import { basename } from 'node:path';
import { type PsRow, foreground, tabInfo } from '../procs.js';
import type { TabState } from '../shared/api.js';


/** Each tab's title and kind, based on the process currently in the foreground of its terminal. */
export function tabStates(
  ptys: { id: number; pid: number; tty: string; shell: string }[],
  ps: PsRow[],
  claudePids: ReadonlySet<number>,
): TabState[] {
  return ptys.map(({ id, pid, tty, shell }) => {
    // If the tty name couldn't be read from the pty, the shell's own process row tells us.
    const terminal = tty || (ps.find((row) => row.pid === pid)?.tty ?? '');
    const fg = terminal === '' ? [] : foreground(ps, terminal);
    return { id, ...tabInfo(fg, pid, basename(shell), claudePids) };
  });
}
