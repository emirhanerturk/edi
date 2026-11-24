import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeLoginEnv, parseEnvBlock, readLoginEnv } from '../src/main/loginEnv.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

const M = '__EDI_ENV_7f3a__';

describe('parseEnvBlock', () => {
  it("skips the noise the shell prints; values may contain '=' and newlines", () => {
    const out = `nvm loaded\nHello!\n${M}PATH=/a:/b\0MULTI=one\ntwo\0EQ=x=y\0${M}\nexit message`;
    expect(parseEnvBlock(out, M)).toEqual({ PATH: '/a:/b', MULTI: 'one\ntwo', EQ: 'x=y' });
  });

  it('returns null without the markers', () => {
    expect(parseEnvBlock('PATH=/a\0', M)).toBeNull();
    expect(parseEnvBlock(`${M}PATH=/a\0`, M)).toBeNull();
  });
});

describe('readLoginEnv', () => {
  /** A fake shell that ignores its flags and runs the given command with sh; it prints noise first. */
  async function fakeShell(body: string): Promise<string> {
    const path = join(await makeTmpDir(), 'fake-shell');
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  it("reads the login shell's environment", async () => {
    const shell = await fakeShell('echo "oh-my-zsh loaded"\nlast=""; for a in "$@"; do last="$a"; done\nFROM_RC=yes\nexport FROM_RC\nexec /bin/sh -c "$last"');
    const env = await readLoginEnv(shell);
    expect(env?.FROM_RC).toBe('yes');
    expect(env?.PATH).toBeTruthy();
  });

  it('reads the environment right away even when the rc file leaves a background job', async () => {
    // The background job holds stdout open; waiting for the shell to exit would hit the timeout.
    const shell = await fakeShell('sleep 5 &\nlast=""; for a in "$@"; do last="$a"; done\nexport FROM_RC=yes\n/bin/sh -c "$last"');
    const started = Date.now();
    const env = await readLoginEnv(shell, { timeoutMs: 3000 });
    expect(env?.FROM_RC).toBe('yes');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('returns null quickly when the shell fails or does not respond', async () => {
    expect(await readLoginEnv(await fakeShell('exit 3'))).toBeNull();
    expect(await readLoginEnv('/no/such/shell')).toBeNull();
    const started = Date.now();
    expect(await readLoginEnv(await fakeShell('sleep 5'), { timeoutMs: 200 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('mergeLoginEnv', () => {
  it("adds the login shell's values but skips shell- and app-specific ones", () => {
    const base = { PATH: '/usr/bin:/bin', HOME: '/Users/u', ELECTRON_RUN_AS_NODE: undefined, EDI_HIDDEN: '1' };
    const login = {
      PATH: '/Users/u/.nvm/bin:/usr/bin:/bin',
      NVM_DIR: '/Users/u/.nvm',
      PWD: '/Users/u',
      OLDPWD: '/',
      SHLVL: '2',
      _: '/usr/bin/env',
      ELECTRON_RUN_AS_NODE: '1',
      EDI_HIDDEN: '0',
    };
    expect(mergeLoginEnv(base, login)).toEqual({
      PATH: '/Users/u/.nvm/bin:/usr/bin:/bin',
      HOME: '/Users/u',
      NVM_DIR: '/Users/u/.nvm',
      ELECTRON_RUN_AS_NODE: undefined,
      EDI_HIDDEN: '1',
    });
  });
});
