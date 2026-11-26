import { access, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

const exists = (path: string) => access(path).then(() => true, () => false);

test('a command typed in the terminal runs in the open folder', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.locator('.term-host.active').click();
    await page.keyboard.type('touch edi-marker\n');
    await expect.poll(() => exists(join(dir, 'edi-marker'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('Cmd+T opens a new tab, Cmd+1 goes back to the first, Cmd+W closes the active tab', async () => {
  const dir = await tmpDir();
  const { app, page } = await launch({ openDir: dir });
  try {
    const tabs = page.getByTestId('tab');
    await expect(tabs).toHaveCount(1);
    await page.locator('.term-host.active').click();

    await page.keyboard.press('Meta+t');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Meta+1');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

    // Each tab has its own terminal: what is typed in the first does not run in the second.
    await page.keyboard.type('touch first-tab\n');
    await expect.poll(() => exists(join(dir, 'first-tab'))).toBe(true);

    await page.keyboard.press('Meta+w');
    await expect(tabs).toHaveCount(1);
    await page.getByTestId('new-terminal').click();
    await expect(tabs).toHaveCount(2);
    // A double click on the empty part of the tab bar opens one too.
    await page.locator('.terminals .tabbar .spacer').dblclick();
    await expect(tabs).toHaveCount(3);
  } finally {
    await app.close();
  }
});

test('when the shell exits, the tab stays and says exited', async () => {
  const dir = await tmpDir();
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.locator('.term-host.active').click();
    await page.keyboard.type('exit\n');
    await expect(page.getByTestId('tab')).toContainText('exited');
    await expect(page.getByTestId('tab')).toHaveCount(1);

    await page.getByRole('button', { name: 'Close tab' }).click();
    await expect(page.getByTestId('tab')).toHaveCount(0);
    await expect(page.getByText('No terminals open')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('switching to another folder reopens the terminals in the new folder', async () => {
  const one = await tmpDir();
  const two = await tmpDir();
  const first = await launch({ openDir: one });
  await first.app.close();

  const { app, page } = await launch({ userData: first.userData, openDir: two });
  try {
    await page.locator('.term-host.active').click();
    await page.keyboard.press('Meta+t');
    await expect(page.getByTestId('tab')).toHaveCount(2);

    await page.getByTestId('project-button').click();
    await page.getByTestId('project-menu').getByRole('menuitem', { name: new RegExp(basename(one)) }).click();
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.locator('.term-host.active').click();
    await page.keyboard.type('touch in-new-folder\n');
    await expect.poll(() => exists(join(one, 'in-new-folder'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('a tab takes the name of the foreground command and asks before closing', async () => {
  const dir = await tmpDir();
  const { app, page } = await launch({ openDir: dir });
  try {
    const tab = page.getByTestId('tab');
    await expect(tab).toContainText('sh');
    await page.locator('.term-host.active').click();
    await page.keyboard.type('sleep 300\n');
    await expect(tab).toContainText('sleep 300', { timeout: 10_000 });

    // No to the first prompt: the tab stays. Yes to the second: it closes.
    const messages: string[] = [];
    page.once('dialog', (dialog) => {
      messages.push(dialog.message());
      void dialog.dismiss();
    });
    await page.keyboard.press('Meta+w');
    await expect(tab).toHaveCount(1);
    expect(messages).toEqual(['A process is still running in this terminal. Close it?']);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.keyboard.press('Meta+w');
    await expect(tab).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a bell shows when a background Claude tab starts waiting, and goes away on returning to the tab', async () => {
  const dir = await tmpDir();
  // A harmless process named "claude" (a symlink to dash): sets the title to "working", then "waiting".
  const bin = await tmpDir('edi-e2e-bin-');
  await symlink('/bin/dash', join(bin, 'claude'));
  await writeFile(join(bin, 'run.sh'), "printf '\\033]0;◐ Task\\007'\nsleep 6\nprintf '\\033]0;✳ Task\\007'\nsleep 30\n");
  const { app, page } = await launch({ openDir: dir });
  try {
    const tabs = page.getByTestId('tab');
    await expect(tabs).toHaveCount(1);
    await page.locator('.term-host.active').click();
    await page.keyboard.type(`${join(bin, 'claude')} ${join(bin, 'run.sh')}\n`);
    await expect(tabs.first()).toHaveAttribute('data-claude', 'true', { timeout: 10_000 });

    await page.keyboard.press('Meta+t');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.first().getByLabel('Needs input')).toBeVisible({ timeout: 10_000 });

    await tabs.first().click();
    await expect(page.getByLabel('Needs input')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('an inactive tab\'s close button shows on hover and closes that tab', async () => {
  const dir = await tmpDir();
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.getByTestId('new-terminal').click();
    const tabs = page.getByTestId('tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    const first = tabs.nth(0);
    const close = first.getByRole('button', { name: 'Close tab' });
    // Its space is reserved but it is hidden; the tab's width does not change on hover.
    await expect(close).toBeHidden();
    const width = (await first.boundingBox())!.width;
    await first.hover();
    await expect(close).toBeVisible();
    expect((await first.boundingBox())!.width).toBe(width);
    await close.click();
    await expect(tabs).toHaveCount(1);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  } finally {
    await app.close();
  }
});

test('+ lists the repositories to open a terminal in, and the tab says which', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await makeRepo(dir, 'beta');
  const { app, page } = await launch({ openDir: dir });
  try {
    const tabs = page.getByTestId('tab');
    await expect(tabs).toHaveCount(1);
    await page.getByTestId('new-terminal').click();
    await page.getByTestId('place-item').filter({ hasText: 'alpha' }).click();
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1).getByTestId('tab-place')).toHaveText('alpha');
    await page.keyboard.type('touch in-alpha\n');
    await expect.poll(() => exists(join(alpha, 'in-alpha'))).toBe(true);

    // ⌥⌘T opens the same list from the keyboard; Esc closes it.
    await page.keyboard.press('Alt+Meta+t');
    await expect(page.getByTestId('place-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
