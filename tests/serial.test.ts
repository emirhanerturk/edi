import { describe, expect, it } from 'vitest';
import { Serial } from '../src/main/serial.js';

/** A task that ends only when `finish` is called, recording when it starts and ends. */
function gate(log: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return {
    task: async () => {
      log.push(`start ${name}`);
      await done;
      log.push(`end ${name}`);
      return name;
    },
    finish,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Serial', () => {
  it('starts a task only after the one before it has ended', async () => {
    const log: string[] = [];
    const serial = new Serial<string>();
    const a = gate(log, 'a');
    const b = gate(log, 'b');
    const first = serial.run('a', a.task);
    const second = serial.run('b', b.task);
    await tick();
    expect(log).toEqual(['start a']);
    a.finish();
    expect(await first).toBe('a');
    await tick();
    expect(log).toEqual(['start a', 'end a', 'start b']);
    b.finish();
    expect(await second).toBe('b');
  });

  it('shares the result of the same task still waiting or running', async () => {
    const log: string[] = [];
    const serial = new Serial<string>();
    const a = gate(log, 'a');
    const first = serial.run('a', a.task);
    const again = serial.run('a', async () => 'never');
    expect(again).toBe(first);
    a.finish();
    expect(await again).toBe('a');
    // Once it has ended, the same key runs again.
    expect(await serial.run('a', async () => 'again')).toBe('again');
  });

  it('goes on with the next task after one fails', async () => {
    const serial = new Serial<string>();
    const failed = serial.run('a', async () => {
      throw new Error('boom');
    });
    const next = serial.run('b', async () => 'b');
    await expect(failed).rejects.toThrow('boom');
    expect(await next).toBe('b');
  });
});
