import { expect, test } from '@playwright/test';
import { answerDialogs, askedDialogs, launch, makeRepo, tmpDir } from './helpers.js';

const gitWidth = (page: import('@playwright/test').Page) => page.locator('.git').evaluate((el) => Math.round(el.getBoundingClientRect().width));

test('the right panel width persists across relaunches', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const first = await launch({ openDir: dir });
  try {
    await expect(first.page.getByTestId('repo-row')).toHaveCount(1);
    expect(await gitWidth(first.page)).toBe(372);

    // Drag the divider 60 pixels to the left: the right panel grows by as much.
    const box = await first.page.getByRole('separator', { name: 'Resize the Git panel' }).boundingBox();
    if (!box) throw new Error('no divider');
    const y = box.y + box.height / 2;
    await first.page.mouse.move(box.x + box.width / 2, y);
    await first.page.mouse.down();
    await first.page.mouse.move(box.x + box.width / 2 - 30, y, { steps: 3 });
    await first.page.mouse.move(box.x + box.width / 2 - 60, y, { steps: 3 });
    await first.page.mouse.up();
    expect(await gitWidth(first.page)).toBe(432);

    // A malformed value from the page is ignored.
    await first.page.evaluate(() => (window as unknown as { edi: { setLayout(patch: unknown): void } }).edi.setLayout({ right: 'wide' }));
  } finally {
    await first.app.close();
  }

  const second = await launch({ openDir: dir, userData: first.userData });
  try {
    await expect(second.page.getByTestId('repo-row')).toHaveCount(1);
    expect(await gitWidth(second.page)).toBe(432);
  } finally {
    await second.app.close();
  }
});

/** Clicks View > Layout > `label` in the app menu. */
async function pickLayout(app: import('@playwright/test').ElectronApplication, label: string) {
  await app.evaluate(({ Menu }, label) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View');
    const layout = view?.submenu?.items.find((item) => item.label === 'Layout');
    const item = layout?.submenu?.items.find((entry) => entry.label === label);
    if (!item) throw new Error(`no menu item: ${label}`);
    item.click();
  }, label);
}

const left = (page: import('@playwright/test').Page, selector: string) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().left);

test('View > Layout puts the terminals on the right; the dividers follow and the choice persists', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const first = await launch({ openDir: dir });
  try {
    await expect(first.page.getByTestId('repo-row')).toHaveCount(1);
    expect(await left(first.page, '.terminals')).toBeLessThan(await left(first.page, '.git'));

    await pickLayout(first.app, 'Terminals on the Right');
    await expect.poll(() => first.page.locator('.app-body').getAttribute('class')).toContain('terminals-right');
    expect(await left(first.page, '.git')).toBe(0);
    expect(await left(first.page, '.git')).toBeLessThan(await left(first.page, '.terminals'));
    expect(await gitWidth(first.page)).toBe(372);

    // The Git panel is now on the left: dragging its divider to the right widens it.
    const box = await first.page.getByRole('separator', { name: 'Resize the Git panel' }).boundingBox();
    if (!box) throw new Error('no divider');
    const y = box.y + box.height / 2;
    await first.page.mouse.move(box.x + box.width / 2, y);
    await first.page.mouse.down();
    await first.page.mouse.move(box.x + box.width / 2 + 30, y, { steps: 3 });
    await first.page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 3 });
    await first.page.mouse.up();
    expect(await gitWidth(first.page)).toBe(432);
  } finally {
    await first.app.close();
  }

  const second = await launch({ openDir: dir, userData: first.userData });
  try {
    await expect(second.page.getByTestId('repo-row')).toHaveCount(1);
    expect(await left(second.page, '.git')).toBe(0);
    expect(await gitWidth(second.page)).toBe(432);
    await pickLayout(second.app, 'Terminals on the Left');
    await expect.poll(() => left(second.page, '.terminals')).toBe(0);
  } finally {
    await second.app.close();
  }
});

test('closing the window with a running process asks first; Cancel keeps it open', async () => {
  const dir = await tmpDir();
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.locator('.term-host.active').click();
    await page.keyboard.type('sleep 60\n');
    await expect(page.getByTestId('tab')).toContainText('sleep', { timeout: 10_000 });

    await answerDialogs(app, 1); // Cancel
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => askedDialogs(app)).toEqual([
      { message: 'Quit edi?', detail: '1 terminal still has a running process.', buttons: ['Quit', 'Cancel'] },
    ]);
    // The window and the terminal are still there.
    await expect(page.getByTestId('tab')).toContainText('sleep');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    await answerDialogs(app, 0);
    await app.close();
  }
});

test('closing without a running process does not ask', async () => {
  const dir = await tmpDir();
  const { app, page } = await launch({ openDir: dir });
  await expect(page.getByTestId('tab')).toHaveCount(1);
  const closed = app.waitForEvent('close');
  // Had a dialog been shown, the Cancel answer would have kept the window open.
  await answerDialogs(app, 1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await closed;
});

test('switching folders with a running process asks first', async () => {
  const dir = await tmpDir();
  const other = await tmpDir();
  await makeRepo(other, 'beta');
  const { app, page } = await launch({ openDir: dir });
  const open = (target: string) =>
    page.evaluate((d) => (window as unknown as { edi: { openFolder(dir: string): Promise<unknown> } }).edi.openFolder(d), target);
  try {
    await page.locator('.term-host.active').click();
    await page.keyboard.type('sleep 60\n');
    await expect(page.getByTestId('tab')).toContainText('sleep', { timeout: 10_000 });

    await answerDialogs(app, 1); // Cancel
    expect(await open(other)).toEqual({ ok: false, error: 'Cancelled', cancelled: true });
    expect(await askedDialogs(app)).toEqual([
      {
        message: 'Switch folders?',
        detail: '1 terminal still has a running process. Switching closes every terminal.',
        buttons: ['Switch', 'Cancel'],
      },
    ]);
    await expect(page.getByTestId('tab')).toContainText('sleep');
    await expect(page.getByTestId('repo-row')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0); // cancelling is not an error

    await answerDialogs(app, 0); // Switch
    expect(await open(other)).toEqual({ ok: true });
    await expect(page.getByTestId('repo-row')).toHaveCount(1);
    await expect(page.getByTestId('tab')).not.toContainText('sleep');
  } finally {
    await app.close();
  }
});
