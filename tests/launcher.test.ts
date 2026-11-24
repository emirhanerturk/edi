import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTmpDir } from './helpers/tmpRepo.js';

const script = join(import.meta.dirname, '..', 'resources', 'edi');

/** Puts a fake `open` that logs its arguments line by line at the front of PATH, then runs the script. */
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

describe('edi command', () => {
  it('opens the app or brings it to the front when given no arguments', async () => {
    expect(await runEdi(await makeTmpDir(), [])).toEqual({ code: 0, stderr: '', open: ['-a', '/Apps/edi.app'] });
  });

  it('passes the folder by its absolute real path to a new instance (the running one takes over)', async () => {
    const root = await realpath(await makeTmpDir());
    await mkdir(join(root, 'boş luk', '-dash'), { recursive: true });
    expect((await runEdi(root, ['.'])).open).toEqual(['-n', '-a', '/Apps/edi.app', '--args', `--open=${root}`]);
    expect((await runEdi(root, ['boş luk'])).open).toEqual(['-n', '-a', '/Apps/edi.app', '--args', `--open=${join(root, 'boş luk')}`]);
    expect((await runEdi(join(root, 'boş luk'), ['-dash'])).open).toEqual([
      '-n',
      '-a',
      '/Apps/edi.app',
      '--args',
      `--open=${join(root, 'boş luk', '-dash')}`,
    ]);
  });

  it('fails without opening the app when the path is not a folder or does not exist', async () => {
    const root = await makeTmpDir();
    await writeFile(join(root, 'file.txt'), 'x');
    expect(await runEdi(root, ['file.txt'])).toEqual({ code: 1, stderr: 'edi: not a folder: file.txt\n', open: [] });
    expect(await runEdi(root, ['missing'])).toEqual({ code: 1, stderr: 'edi: not a folder: missing\n', open: [] });
  });

  it('prints usage when given more than one argument', async () => {
    expect(await runEdi(await makeTmpDir(), ['a', 'b'])).toEqual({ code: 2, stderr: 'usage: edi [folder]\n', open: [] });
  });
});
