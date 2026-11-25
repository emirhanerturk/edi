import { execFile } from 'node:child_process';
import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);
const script = join(__dirname, '..', 'resources', 'edi');

/** Runs the `edi` command in `cwd` with a stand-in `open` that prints its arguments. */
async function edi(cwd: string, args: string[], env: Record<string, string> = {}) {
  const bin = await makeTmpDir();
  await writeFile(join(bin, 'open'), '#!/bin/sh\necho "open $*"\n');
  await chmod(join(bin, 'open'), 0o755);
  return run('/bin/sh', [script, ...args], { cwd, env: { PATH: `${bin}:/usr/bin:/bin`, EDI_APP: '/A/edi.app', ...env } }).then(
    ({ stdout }) => ({ code: 0, out: stdout.trim() }),
    (error: { code: number; stderr: string }) => ({ code: error.code, out: error.stderr.trim() }),
  );
}

describe('the edi command', () => {
  it('opens the folder by its real path', async () => {
    const dir = await realpath(await makeTmpDir());
    await mkdir(join(dir, 'w'));
    expect(await edi(dir, ['w'])).toEqual({ code: 0, out: `open -n -a /A/edi.app --args --open=${join(dir, 'w')}` });
  });

  it('"-" is a folder named -, not the previous folder', async () => {
    const dir = await realpath(await makeTmpDir());
    expect(await edi(dir, ['-'], { OLDPWD: '/usr' })).toEqual({ code: 1, out: 'edi: not a folder: -' });
    await mkdir(join(dir, '-'));
    expect(await edi(dir, ['-'], { OLDPWD: '/usr' })).toEqual({ code: 0, out: `open -n -a /A/edi.app --args --open=${join(dir, '-')}` });
  });

  it('a file or a missing path is not a folder; a folder it may not enter says so', async () => {
    const dir = await realpath(await makeTmpDir());
    await writeFile(join(dir, 'f'), '');
    await mkdir(join(dir, 'locked'), { mode: 0o000 });
    expect(await edi(dir, ['f'])).toEqual({ code: 1, out: 'edi: not a folder: f' });
    expect(await edi(dir, ['gone'])).toEqual({ code: 1, out: 'edi: not a folder: gone' });
    expect(await edi(dir, ['locked'])).toEqual({ code: 1, out: 'edi: no permission to open locked' });
    await chmod(join(dir, 'locked'), 0o755);
  });
});
