import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Launcher, defaultLaunchers, openInZed } from '../src/main/openInZed.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

/** Aldığı argümanları satır satır bir dosyaya yazan sahte program. */
async function recorder(dir: string, name: string, exitCode = 0): Promise<{ launcher: Launcher; calls: () => Promise<string[]> }> {
  const log = join(dir, `${name}.log`);
  const script = join(dir, name);
  await writeFile(script, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${log}"; done\nexit ${exitCode}\n`);
  await chmod(script, 0o755);
  return {
    launcher: { command: script, args: (target) => [target] },
    calls: () => readFile(log, 'utf8').then((text) => text.split('\n').filter(Boolean), () => []),
  };
}

describe('openInZed', () => {
  it('sırayla dener: ilki yoksa ikincisi açar, üçüncü çalışmaz', async () => {
    const dir = await makeTmpDir();
    const second = await recorder(dir, 'second');
    const third = await recorder(dir, 'third');
    const missing: Launcher = { command: join(dir, 'yok-boyle-program'), args: (target) => [target] };

    expect(await openInZed('/tmp/x.ts', [missing, second.launcher, third.launcher])).toEqual({ ok: true, message: 'Opened in Zed' });
    expect(await second.calls()).toEqual(['/tmp/x.ts']);
    expect(await third.calls()).toEqual([]);
  });

  it('hata koduyla çıkan programdan sonrakine geçer', async () => {
    const dir = await makeTmpDir();
    const failing = await recorder(dir, 'failing', 3);
    const working = await recorder(dir, 'working');
    expect((await openInZed('/tmp/x.ts', [failing.launcher, working.launcher])).ok).toBe(true);
    expect(await working.calls()).toEqual(['/tmp/x.ts']);
  });

  it('hiçbiri açamazsa hata döner', async () => {
    const dir = await makeTmpDir();
    const failing = await recorder(dir, 'failing', 1);
    const missing: Launcher = { command: join(dir, 'yok'), args: (target) => [target] };
    expect(await openInZed('/tmp/x.ts', [missing, failing.launcher])).toEqual({ ok: false, error: 'Could not open Zed' });
    expect(await openInZed('/tmp/x.ts', [])).toEqual({ ok: false, error: 'Could not open Zed' });
  });

  it('hedef tek argüman olarak gider; kabuk yorumlamaz', async () => {
    const dir = await makeTmpDir();
    const rec = await recorder(dir, 'rec');
    const target = join(dir, 'boş klasör', '$(touch pwned) `id` ; rm -rf x.ts');
    expect((await openInZed(target, [rec.launcher])).ok).toBe(true);
    expect(await rec.calls()).toEqual([target]);
    await expect(readFile(join(dir, 'pwned'))).rejects.toThrow();
    await expect(readFile(join(process.cwd(), 'pwned'))).rejects.toThrow();
  });

  it('göreli hedefi reddeder: seçenek gibi yorumlanabilecek bir şey programa gitmez', async () => {
    const dir = await makeTmpDir();
    const rec = await recorder(dir, 'rec');
    expect(await openInZed('--wait', [rec.launcher])).toEqual({ ok: false, error: 'Could not open Zed' });
    expect(await openInZed('x.ts', [rec.launcher])).toEqual({ ok: false, error: 'Could not open Zed' });
    expect(await rec.calls()).toEqual([]);
  });
});

describe('defaultLaunchers', () => {
  it("önce PATH'teki zed, sonra uygulamanın içindeki cli, sonra open -a Zed", () => {
    const launchers = defaultLaunchers();
    expect(launchers.map((l) => l.command)).toEqual(['zed', '/Applications/Zed.app/Contents/MacOS/cli', 'open']);
    expect(launchers.map((l) => l.args('/a/b.ts'))).toEqual([['/a/b.ts'], ['/a/b.ts'], ['-a', 'Zed', '/a/b.ts']]);
  });
});
