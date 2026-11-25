import { describe, expect, it } from 'vitest';
import { KeepAwake, type SleepBlocker } from '../src/main/keepAwake.js';

/** A stand-in for Electron's powerSaveBlocker that records what it was asked. */
function fakeBlocker() {
  const active = new Set<number>();
  const calls: string[] = [];
  let next = 1;
  const blocker: SleepBlocker = {
    start(type) {
      calls.push(`start ${type}`);
      active.add(next);
      return next++;
    },
    stop(id) {
      calls.push(`stop ${id}`);
      active.delete(id);
    },
    isStarted: (id) => active.has(id),
  };
  return { blocker, active, calls };
}

describe('KeepAwake', () => {
  it('keeps the Mac from sleeping only while on; the display may still sleep', () => {
    const { blocker, active, calls } = fakeBlocker();
    const awake = new KeepAwake(blocker, false);
    expect(active.size).toBe(0);
    awake.setEnabled(true);
    expect(calls).toEqual(['start prevent-app-suspension']);
    expect(active.size).toBe(1);
    awake.setEnabled(true); // already on: no second blocker
    expect(active.size).toBe(1);
    awake.setEnabled(false);
    expect(active.size).toBe(0);
    awake.setEnabled(false);
    expect(calls).toEqual(['start prevent-app-suspension', 'stop 1']);
  });

  it('starts on when the saved setting is on, and lets go when the app quits', () => {
    const { blocker, active } = fakeBlocker();
    const awake = new KeepAwake(blocker, true);
    expect(active.size).toBe(1);
    awake.dispose();
    expect(active.size).toBe(0);
  });
});
