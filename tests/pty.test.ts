import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyManager, shellEnv } from '../src/main/pty.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

const managers: PtyManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.killAll();
});

function makeManager() {
  const output = new Map<number, string>();
  const exited: number[] = [];
  const manager = new PtyManager({
    shell: '/bin/sh',
    // The profile of whoever runs the tests stays out of them.
    login: false,
    onData: (id, data) => output.set(id, (output.get(id) ?? '') + data),
    onExit: (id) => exited.push(id),
  });
  managers.push(manager);
  return { manager, output, exited };
}

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('the expected state never arrived');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('shellEnv', () => {
  it('removes Claude Code and Electron traces and identifies the terminal', () => {
    const env = shellEnv({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '1234',
      ELECTRON_RUN_AS_NODE: '1',
      EDI_USER_DATA: '/tmp/x',
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-is',
      EMPTY: undefined,
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-is', // the user's own setting: left untouched
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'edi',
    });
  });
});

describe('PtyManager', () => {
  it('opens a login shell unless told not to', async () => {
    // A stand-in shell that prints the arguments it was given.
    const shell = join(await makeTmpDir(), 'shell');
    await writeFile(shell, '#!/bin/sh\necho "args=[$*]"\n');
    await chmod(shell, 0o755);
    const args = async (login?: boolean) => {
      let out = '';
      let done = false;
      const manager = new PtyManager({ shell, login, onData: (_id, data) => (out += data), onExit: () => (done = true) });
      managers.push(manager);
      manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir() });
      await until(() => done);
      return /args=\[(.*)\]/.exec(out)?.[1];
    };
    expect(await args()).toBe('-l');
    expect(await args(false)).toBe('');
  });

  it('emits command output and reports the exit', async () => {
    const { manager, output, exited } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir() });
    manager.write(id, 'echo edi-$((40+2)); exit\n');

    await until(() => exited.includes(id));
    expect(output.get(id)).toContain('edi-42');
    expect(manager.ids()).toEqual([]);
    expect(manager.info(id)).toBeNull();
  });

  it('starts the shell in the given folder with a cleaned environment', async () => {
    process.env.CLAUDECODE = '1';
    try {
      const { manager, output } = makeManager();
      const cwd = await makeTmpDir();
      const id = manager.create({ cols: 80, rows: 24, cwd });
      manager.write(id, 'echo "cwd=$(pwd -P) cc=[${CLAUDECODE-missing}] tp=$TERM_PROGRAM"\n');
      await until(() => (output.get(id) ?? '').includes('tp=edi'));
      expect(output.get(id)).toContain(`cwd=${cwd} cc=[missing] tp=edi`);
    } finally {
      delete process.env.CLAUDECODE;
    }
  });

  it('runs the startup command inside the shell', async () => {
    const { manager, output } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir(), command: 'echo start-$((1+1))' });
    await until(() => (output.get(id) ?? '').includes('start-2'));
    expect(manager.ids()).toEqual([id]); // the shell stays open after the command finishes
  });

  it('does not throw when writing to, resizing or killing a dead or unknown pty', async () => {
    const { manager, exited } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir() });
    manager.write(id, 'exit\n');
    await until(() => exited.includes(id));

    expect(() => {
      manager.write(id, 'x');
      manager.resize(id, 100, 30);
      manager.kill(id);
      manager.write(999, 'x');
      manager.resize(999, 0, 0);
      manager.kill(999);
    }).not.toThrow();
  });

  it('one tab exiting does not affect another', async () => {
    const { manager, output, exited } = makeManager();
    const cwd = await makeTmpDir();
    const a = manager.create({ cols: 80, rows: 24, cwd });
    const b = manager.create({ cols: 80, rows: 24, cwd });
    manager.write(a, 'exit\n');
    await until(() => exited.includes(a));

    manager.write(b, 'echo still-$((2+3))\n');
    await until(() => (output.get(b) ?? '').includes('still-5'));
    expect(manager.ids()).toEqual([b]);
  });

  it('info returns the tty name without the /dev prefix', async () => {
    const { manager } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir() });
    const info = manager.info(id);
    expect(info?.tty).toMatch(/^ttys\d+$/);
    expect(info?.shell).toBe('/bin/sh');
    expect(info?.pid).toBeGreaterThan(0);
  });

  it('killAll closes them all without reporting exits', async () => {
    const { manager, exited } = makeManager();
    const cwd = await makeTmpDir();
    manager.create({ cols: 80, rows: 24, cwd });
    manager.create({ cols: 80, rows: 24, cwd });
    manager.killAll();
    expect(manager.ids()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(exited).toEqual([]);
  });

  it('clamps an invalid size to the minimum', async () => {
    const { manager } = makeManager();
    const id = manager.create({ cols: 0, rows: Number.NaN, cwd: await makeTmpDir() });
    expect(manager.ids()).toEqual([id]);
    expect(() => manager.resize(id, -5, 0)).not.toThrow();
  });
});
