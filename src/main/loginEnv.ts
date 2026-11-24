import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * An app launched from the Dock doesn't get the user's shell settings (PATH: node from nvm, Homebrew);
 * git hooks fail with "node not found". When the packaged app starts, the login shell's
 * environment is read once and added to the main process's environment.
 */

/** The `env -0` output between the two markers; noise the shell prints before and after is skipped. */
export function parseEnvBlock(out: string, marker: string): Record<string, string> | null {
  const start = out.indexOf(marker);
  const end = start === -1 ? -1 : out.indexOf(marker, start + marker.length);
  if (end === -1) return null;
  const env: Record<string, string> = {};
  for (const entry of out.slice(start + marker.length, end).split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/** The login shell's (`-il`) environment. Null if the shell fails or doesn't finish within `timeoutMs`. */
export function readLoginEnv(shell: string, opts: { timeoutMs?: number } = {}): Promise<Record<string, string> | null> {
  const { timeoutMs = 10_000 } = opts;
  const marker = `__EDI_ENV_${randomBytes(6).toString('hex')}__`;
  const command = `printf '%s' '${marker}'; /usr/bin/env -0; printf '%s' '${marker}'`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: Record<string, string> | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    // In its own process group: on timeout, everything the shell started is killed with it.
    const child = spawn(shell, ['-ilc', command], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already finished.
      }
      finish(null);
    }, timeoutMs);
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      // Once the second marker arrives the environment is complete: we don't wait for the shell to exit,
      // even if a job the rc left in the background keeps stdout open.
      const env = parseEnvBlock(Buffer.concat(chunks).toString('utf8'), marker);
      if (env) finish(env);
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
  });
}

/** Shell- or app-specific variables that are not carried over. */
const SKIPPED = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);
const skipped = (name: string) => SKIPPED.has(name) || name.startsWith('ELECTRON_') || name.startsWith('EDI_');

/** The login shell's values are added or override existing ones; the app's own settings are kept. */
export function mergeLoginEnv(base: NodeJS.ProcessEnv, login: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const [name, value] of Object.entries(login)) {
    if (!skipped(name)) env[name] = value;
  }
  return env;
}
