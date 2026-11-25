import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Launcher, defaultLaunchers, openIn } from '../src/main/openIn.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

/** A fake program that writes its arguments to a file line by line. */
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

describe('openIn', () => {
  it('tries in order: when the first is missing the second opens it and the third never runs', async () => {
    const dir = await makeTmpDir();
    const second = await recorder(dir, 'second');
    const third = await recorder(dir, 'third');
    const missing: Launcher = { command: join(dir, 'no-such-program'), args: (target) => [target] };

    expect(await openIn('zed', '/tmp/x.ts', [missing, second.launcher, third.launcher])).toEqual({ ok: true, message: 'Opened in Zed' });
    expect(await second.calls()).toEqual(['/tmp/x.ts']);
    expect(await third.calls()).toEqual([]);
  });

  it('names the editor in its answer', async () => {
    const dir = await makeTmpDir();
    const rec = await recorder(dir, 'rec');
    expect(await openIn('antigravity', '/tmp/x.ts', [rec.launcher])).toEqual({ ok: true, message: 'Opened in Antigravity' });
    expect(await openIn('antigravity', '/tmp/x.ts', [])).toEqual({ ok: false, error: 'Could not open Antigravity' });
  });

  it('counts a program still running at the timeout as opening it, and tries no other way (an app starting cold)', async () => {
    const dir = await makeTmpDir();
    const slow = join(dir, 'slow');
    await writeFile(slow, '#!/bin/sh\nsleep 5\n');
    await chmod(slow, 0o755);
    const next = await recorder(dir, 'next');
    expect(await openIn('zed', '/tmp/x.ts', [{ command: slow, args: (target) => [target] }, next.launcher], 200)).toEqual({ ok: true, message: 'Opened in Zed' });
    expect(await next.calls()).toEqual([]);
  });

  it('moves on after a program that exits with an error code', async () => {
    const dir = await makeTmpDir();
    const failing = await recorder(dir, 'failing', 3);
    const working = await recorder(dir, 'working');
    expect((await openIn('zed', '/tmp/x.ts', [failing.launcher, working.launcher])).ok).toBe(true);
    expect(await working.calls()).toEqual(['/tmp/x.ts']);
  });

  it('returns an error when none can open it', async () => {
    const dir = await makeTmpDir();
    const failing = await recorder(dir, 'failing', 1);
    const missing: Launcher = { command: join(dir, 'missing'), args: (target) => [target] };
    expect(await openIn('zed', '/tmp/x.ts', [missing, failing.launcher])).toEqual({ ok: false, error: 'Could not open Zed' });
    expect(await openIn('zed', '/tmp/x.ts', [])).toEqual({ ok: false, error: 'Could not open Zed' });
  });

  it('passes the target as a single argument without shell interpretation', async () => {
    const dir = await makeTmpDir();
    const rec = await recorder(dir, 'rec');
    const target = join(dir, 'boş klasör', '$(touch pwned) `id` ; rm -rf x.ts');
    expect((await openIn('zed', target, [rec.launcher])).ok).toBe(true);
    expect(await rec.calls()).toEqual([target]);
    await expect(readFile(join(dir, 'pwned'))).rejects.toThrow();
    await expect(readFile(join(process.cwd(), 'pwned'))).rejects.toThrow();
  });

  it('rejects a relative target so nothing that could be read as an option reaches the program', async () => {
    const dir = await makeTmpDir();
    const rec = await recorder(dir, 'rec');
    expect(await openIn('zed', '--wait', [rec.launcher])).toEqual({ ok: false, error: 'Could not open Zed' });
    expect(await openIn('zed', 'x.ts', [rec.launcher])).toEqual({ ok: false, error: 'Could not open Zed' });
    expect(await rec.calls()).toEqual([]);
  });
});

describe('defaultLaunchers', () => {
  it("opens the app by its bundle id through macOS's open, the usual release first", () => {
    expect(defaultLaunchers('zed').map((l) => [l.command, ...l.args('/a/b.ts')])).toEqual([
      ['open', '-b', 'dev.zed.Zed', '/a/b.ts'],
      ['open', '-b', 'dev.zed.Zed-Preview', '/a/b.ts'],
    ]);
    expect(defaultLaunchers('antigravity').map((l) => [l.command, ...l.args('/a/b.ts')])).toEqual([['open', '-b', 'com.google.antigravity-ide', '/a/b.ts']]);
  });
});
