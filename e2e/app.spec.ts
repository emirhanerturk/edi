import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

test('the window opens with edi in the title bar', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByTestId('titlebar')).toContainText('edi');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(40, 44, 52)');
    // The page has no access to Node; only the bridge object exists.
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (window as unknown as { edi?: unknown }).edi)).toBe('object');
  } finally {
    await app.close();
  }
});

test('without a project yet, the Projects screen offers only New project', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
    await expect(page.getByTestId('new-project-card')).toBeVisible();
    await expect(page.getByTestId('project-card')).toHaveCount(0);
    await expect(page.getByTestId('statusbar')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('opening a folder shows the repo count in the status bar and its name in the title bar', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const beta = await makeRepo(dir, 'beta');
  await writeFile(join(beta, 'new.txt'), 'x\n');

  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('statusbar')).toContainText('2 repositories');
    await expect(page.getByTestId('statusbar')).toContainText('1 with changes');
    await expect(page.getByTestId('project-button')).toContainText(basename(dir));
    await expect(page.getByRole('heading', { name: 'Projects' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('nothing opens on its own at relaunch: the projects are listed, the last one marked, and one opens on a click', async () => {
  const one = await tmpDir();
  await makeRepo(one, 'alpha');
  const two = await tmpDir();
  await makeRepo(two, 'beta');
  await makeRepo(two, 'gamma');

  const first = await launch({ openDir: one });
  await expect(first.page.getByTestId('statusbar')).toContainText('1 repository');
  await first.app.close();

  const second = await launch({ userData: first.userData, openDir: two });
  await expect(second.page.getByTestId('statusbar')).toContainText('2 repositories');
  await second.app.close();

  // Launched without a folder: the Projects screen, the last project opened first and marked.
  const third = await launch({ userData: first.userData });
  try {
    await expect(third.page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(third.page.getByTestId('statusbar')).toHaveCount(0);
    const cards = third.page.getByTestId('project-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText(basename(two));
    await expect(cards.nth(0)).toContainText('Last opened');
    await expect(cards.nth(0)).toContainText('2 repos');
    await expect(cards.nth(1)).toContainText(basename(one));
    await expect(cards.nth(1)).not.toContainText('Last opened');

    await cards.nth(1).getByRole('button').first().click();
    await expect(third.page.getByTestId('statusbar')).toContainText('1 repository');
    await expect(third.page.getByTestId('project-button')).toContainText(basename(one));

    // The other project is in the title bar's menu.
    await third.page.getByTestId('project-button').click();
    const menu = third.page.getByTestId('project-menu');
    await expect(menu).toContainText(basename(two));
    await expect(menu).toContainText('New project…');
    await menu.getByRole('menuitem', { name: new RegExp(basename(two)) }).click();
    await expect(third.page.getByTestId('statusbar')).toContainText('2 repositories');
    await expect(third.page.getByTestId('project-button')).toContainText(basename(two));
  } finally {
    await third.app.close();
  }
});

/** Feeds status JSON to the bridge script, as Claude Code does. */
function bridge(file: string, limits: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('/bin/sh', [join(import.meta.dirname, '..', 'resources', 'edi-statusline')], { env: { PATH: '/usr/bin:/bin', EDI_USAGE_FILE: file } }, (error) =>
      error ? reject(error) : resolve(),
    );
    child.stdin!.end(JSON.stringify({ cwd: '/x', rate_limits: limits }));
  });
}

test('Claude usage limits come from the bridge, show in the title bar and refresh when they change', async () => {
  const file = join(await tmpDir(), 'claude-usage.json');
  const soon = Math.floor(Date.now() / 1000) + 2 * 3600;
  const later = Math.floor(Date.now() / 1000) + 3 * 86400;
  await bridge(file, { five_hour: { used_percentage: 42, resets_at: soon }, seven_day: { used_percentage: 18, resets_at: later } });
  const { app, page } = await launch({ usageFile: file });
  try {
    const windows = page.getByTestId('usage-window');
    await expect(windows).toHaveCount(2);
    await expect(windows.nth(0)).toContainText('5h');
    await expect(windows.nth(0)).toContainText('42%');
    await expect(windows.nth(1)).toContainText('18%');
    // Hovering opens the details right under it; the title bar's drag area doesn't swallow the pointer.
    await page.getByTestId('usage').hover();
    await expect(page.getByTestId('usage-detail')).toHaveCount(2);
    await expect(page.getByTestId('usage-detail').nth(1)).toContainText('Weekly limit');
    await page.mouse.move(10, 400);
    await expect(page.getByTestId('usage-panel')).toHaveCount(0);
    await bridge(file, { five_hour: { used_percentage: 93, resets_at: soon }, seven_day: { used_percentage: 20, resets_at: later } });
    await expect(windows.nth(0)).toContainText('93%', { timeout: 10_000 });
    await expect(windows.nth(0)).toHaveAttribute('data-level', 'high');
  } finally {
    await app.close();
  }
});

test('without the bridge there is no usage indicator', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByTestId('titlebar')).toContainText('edi');
    await expect(page.getByTestId('usage')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
