// Opens a file or folder in an editor. No shell is used: the target is passed as a single argument.
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { type EditorId, editorName } from '../shared/editors.js';
import type { OpResult } from '../shared/api.js';

export interface Launcher {
  command: string;
  args: (target: string) => string[];
}

/** The apps' bundle ids, tried in order: the usual release first. */
const BUNDLE_IDS: Record<EditorId, string[]> = {
  antigravity: ['com.google.antigravity-ide'],
  zed: ['dev.zed.Zed', 'dev.zed.Zed-Preview'],
};

/**
 * macOS's `open -b`: Launch Services finds the app wherever it is installed, with no command on PATH
 * needed, and `open` returns as soon as the app has the file. It fails at once if no such app is installed.
 */
export function defaultLaunchers(editor: EditorId): Launcher[] {
  return BUNDLE_IDS[editor].map((id) => ({ command: 'open', args: (target) => ['-b', id, target] }));
}

const TIMEOUT_MS = 5000;

/**
 * 'opened' also when the program is still running at the timeout: an app starting cold can take that
 * long, and trying the next way would open the file a second time.
 */
function run(command: string, args: string[], timeoutMs: number): Promise<'opened' | 'failed'> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { timeout: timeoutMs }, (error) => resolve(error === null || error.killed ? 'opened' : 'failed'));
    } catch {
      resolve('failed');
    }
  });
}

/** `target` must be an absolute path: nothing starting with `-` can reach the program as an option. */
export async function openIn(
  editor: EditorId,
  target: string,
  launchers: Launcher[] = defaultLaunchers(editor),
  timeoutMs = TIMEOUT_MS,
): Promise<OpResult> {
  const failed: OpResult = { ok: false, error: `Could not open ${editorName(editor)}` };
  if (typeof target !== 'string' || !isAbsolute(target) || target.includes('\0')) return failed;
  for (const launcher of launchers) {
    if ((await run(launcher.command, launcher.args(target), timeoutMs)) === 'opened') return { ok: true, message: `Opened in ${editorName(editor)}` };
  }
  return failed;
}
