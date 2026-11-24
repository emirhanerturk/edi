// Opens a file or folder in Zed. No shell is used: the target is passed as a single argument.
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { OpResult } from '../shared/api.js';

export interface Launcher {
  command: string;
  args: (target: string) => string[];
}

/** Tried in order: `zed` on PATH, the cli inside the app bundle, and finally macOS's `open` command. */
export function defaultLaunchers(): Launcher[] {
  return [
    { command: 'zed', args: (target) => [target] },
    { command: '/Applications/Zed.app/Contents/MacOS/cli', args: (target) => [target] },
    { command: 'open', args: (target) => ['-a', 'Zed', target] },
  ];
}

const TIMEOUT_MS = 5000;

function run(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { timeout: TIMEOUT_MS }, (error) => resolve(error === null));
    } catch {
      resolve(false);
    }
  });
}

const FAILED: OpResult = { ok: false, error: 'Could not open Zed' };

/** `target` must be an absolute path: nothing starting with `-` can reach the program as an option. */
export async function openInZed(target: string, launchers: Launcher[] = defaultLaunchers()): Promise<OpResult> {
  if (typeof target !== 'string' || !isAbsolute(target) || target.includes('\0')) return FAILED;
  for (const launcher of launchers) {
    if (await run(launcher.command, launcher.args(target))) return { ok: true, message: 'Opened in Zed' };
  }
  return FAILED;
}
