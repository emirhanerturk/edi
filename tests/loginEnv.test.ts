import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeLoginEnv, parseEnvBlock, readLoginEnv } from '../src/main/loginEnv.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

const M = '__EDI_ENV_7f3a__';

describe('parseEnvBlock', () => {
  it("kabuğun bastığı gürültüyü atlar; değerde '=' ve satır sonu olabilir", () => {
    const out = `nvm yüklendi\nMerhaba!\n${M}PATH=/a:/b\0MULTI=bir\niki\0EQ=x=y\0${M}\nçıkış mesajı`;
    expect(parseEnvBlock(out, M)).toEqual({ PATH: '/a:/b', MULTI: 'bir\niki', EQ: 'x=y' });
  });

  it('işaretler yoksa null', () => {
    expect(parseEnvBlock('PATH=/a\0', M)).toBeNull();
    expect(parseEnvBlock(`${M}PATH=/a\0`, M)).toBeNull();
  });
});

describe('readLoginEnv', () => {
  /** Bayrakları yok sayıp verilen komutu sh ile çalıştıran sahte kabuk; önce gürültü basar. */
  async function fakeShell(body: string): Promise<string> {
    const path = join(await makeTmpDir(), 'fake-shell');
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  it('giriş kabuğunun ortamını okur', async () => {
    const shell = await fakeShell('echo "oh-my-zsh yüklendi"\nlast=""; for a in "$@"; do last="$a"; done\nFROM_RC=evet\nexport FROM_RC\nexec /bin/sh -c "$last"');
    const env = await readLoginEnv(shell);
    expect(env?.FROM_RC).toBe('evet');
    expect(env?.PATH).toBeTruthy();
  });

  it('rc dosyası arka planda bir iş bıraksa da ortam hemen okunur', async () => {
    // Arka plandaki iş stdout'u açık tutar; kabuğun bitişini beklemek zaman aşımına düşürürdü.
    const shell = await fakeShell('sleep 5 &\nlast=""; for a in "$@"; do last="$a"; done\nexport FROM_RC=evet\n/bin/sh -c "$last"');
    const started = Date.now();
    const env = await readLoginEnv(shell, { timeoutMs: 3000 });
    expect(env?.FROM_RC).toBe('evet');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('kabuk hata verirse ya da yanıt vermezse null; uzun sürmez', async () => {
    expect(await readLoginEnv(await fakeShell('exit 3'))).toBeNull();
    expect(await readLoginEnv('/olmayan/kabuk')).toBeNull();
    const started = Date.now();
    expect(await readLoginEnv(await fakeShell('sleep 5'), { timeoutMs: 200 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('mergeLoginEnv', () => {
  it('giriş kabuğunun değerleri eklenir; kabuğa ve uygulamaya özgü olanlar alınmaz', () => {
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
