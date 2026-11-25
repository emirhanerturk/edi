import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { launch, tmpDir } from './helpers.js';

/** Whether macOS lists a hold on idle sleep from the process `pid`. */
const holdsSleep = (pid: number) =>
  execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' })
    .split('\n')
    // Electron's hold is listed as NoIdleSleepAssertion, the older name of PreventUserIdleSystemSleep.
    .some((line) => line.includes(`pid ${pid}(`) && /NoIdleSleepAssertion|PreventUserIdleSystemSleep/.test(line));

test('View > Keep Mac Awake holds off sleep while checked, and is remembered', async () => {
  const userData = await tmpDir();
  const first = await launch({ userData });
  const pid = first.app.process().pid!;
  const toggle = () =>
    first.app.evaluate(({ BrowserWindow, Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find((item) => item.label === 'View')!;
      const item = view.submenu!.items.find((entry) => entry.label === 'Keep Mac Awake')!;
      // As a click in the menu does: the box flips, then the handler runs.
      item.click(undefined, BrowserWindow.getAllWindows()[0]);
      return item.checked;
    });
  try {
    expect(holdsSleep(pid)).toBe(false);
    expect(await toggle()).toBe(true);
    await expect.poll(() => holdsSleep(pid)).toBe(true);
    expect(await toggle()).toBe(false);
    await expect.poll(() => holdsSleep(pid)).toBe(false);
    expect(await toggle()).toBe(true);
  } finally {
    await first.app.close();
  }

  // The next start comes up awake with the box checked.
  const second = await launch({ userData });
  try {
    const checked = await second.app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find((item) => item.label === 'View')!;
      return view.submenu!.items.find((entry) => entry.label === 'Keep Mac Awake')!.checked;
    });
    expect(checked).toBe(true);
    await expect.poll(() => holdsSleep(second.app.process().pid!)).toBe(true);
  } finally {
    await second.app.close();
  }
});
