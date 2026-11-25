// The environment given to child processes (git, terminals): the app's own, plus the login shell's.
import { mergeLoginEnv } from './main/loginEnv.js';

let login: Record<string, string> | null = null;

/**
 * Takes the login shell's environment (see `readLoginEnv`). It reaches only the processes started
 * from now on; the app's own `process.env` stays as it started, so nothing the runtime reads while
 * running (TZ, NODE_*, DYLD_*) changes under it.
 */
export function setLoginEnv(env: Record<string, string> | null): void {
  login = env;
}

/** A fresh copy for a child process to start with. */
export function childEnv(): NodeJS.ProcessEnv {
  return login ? mergeLoginEnv(process.env, login) : { ...process.env };
}
