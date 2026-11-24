import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTmpDir } from './helpers/tmpRepo.js';

const script = join(import.meta.dirname, '..', 'resources', 'edi');

/** PATH'in başına argümanlarını satır satır yazan sahte bir `open` koyup betiği çalıştırır. */
async function runEdi(cwd: string, args: string[]): Promise<{ code: number; stderr: string; open: string[] }> {
  const bin = await makeTmpDir();
  const log = join(bin, 'open.log');
  await writeFile(join(bin, 'open'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${log}"; done\n`);
  await chmod(join(bin, 'open'), 0o755);
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      [script, ...args],
      { cwd, env: { PATH: `${bin}:/usr/bin:/bin`, EDI_APP: '/Apps/edi.app' } },
      async (error, _stdout, stderr) => {
        const open = await readFile(log, 'utf8').then((text) => text.split('\n').filter(Boolean), () => []);
        resolve({ code: error ? Number(error.code) : 0, stderr, open });
      },
    );
  });
}

describe('edi komutu', () => {
  it('argümansız: uygulamayı açar ya da öne getirir', async () => {
    expect(await runEdi(await makeTmpDir(), [])).toEqual({ code: 0, stderr: '', open: ['-a', '/Apps/edi.app'] });
  });

  it('klasörü mutlak ve gerçek yoluyla yeni bir kopyaya verir (açık kopya devralır)', async () => {
    const root = await realpath(await makeTmpDir());
    await mkdir(join(root, 'boş luk', '-tire'), { recursive: true });
    expect((await runEdi(root, ['.'])).open).toEqual(['-n', '-a', '/Apps/edi.app', '--args', `--open=${root}`]);
    expect((await runEdi(root, ['boş luk'])).open).toEqual(['-n', '-a', '/Apps/edi.app', '--args', `--open=${join(root, 'boş luk')}`]);
    expect((await runEdi(join(root, 'boş luk'), ['-tire'])).open).toEqual([
      '-n',
      '-a',
      '/Apps/edi.app',
      '--args',
      `--open=${join(root, 'boş luk', '-tire')}`,
    ]);
  });

  it('klasör değilse ya da yoksa hata verir, uygulamayı açmaz', async () => {
    const root = await makeTmpDir();
    await writeFile(join(root, 'dosya.txt'), 'x');
    expect(await runEdi(root, ['dosya.txt'])).toEqual({ code: 1, stderr: 'edi: not a folder: dosya.txt\n', open: [] });
    expect(await runEdi(root, ['yok'])).toEqual({ code: 1, stderr: 'edi: not a folder: yok\n', open: [] });
  });

  it('birden çok argüman: kullanım', async () => {
    expect(await runEdi(await makeTmpDir(), ['a', 'b'])).toEqual({ code: 2, stderr: 'usage: edi [folder]\n', open: [] });
  });
});
