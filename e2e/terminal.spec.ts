import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

const exists = (path: string) => access(path).then(() => true, () => false);

test('terminalde yazılan komut açık klasörde çalışır', async () => {
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

test('Cmd+T yeni sekme açar, Cmd+1 ilkine döner, Cmd+W etkin sekmeyi kapatır', async () => {
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

    // Her sekmenin kendi terminali var: ilkinde yazılan ikincide çalışmaz.
    await page.keyboard.type('touch ilk-sekme\n');
    await expect.poll(() => exists(join(dir, 'ilk-sekme'))).toBe(true);

    await page.keyboard.press('Meta+w');
    await expect(tabs).toHaveCount(1);
    await page.getByTestId('new-terminal').click();
    await expect(tabs).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('kabuk kapanınca sekme yerinde kalır ve exited yazar', async () => {
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

test('başka klasöre geçince terminaller yeni klasörde yeniden açılır', async () => {
  const one = await tmpDir();
  const two = await tmpDir();
  const first = await launch({ openDir: one });
  await first.app.close();

  const { app, page } = await launch({ userData: first.userData, openDir: two });
  try {
    await page.locator('.term-host.active').click();
    await page.keyboard.press('Meta+t');
    await expect(page.getByTestId('tab')).toHaveCount(2);

    await page.getByTestId('folder-button').click();
    await page.getByTestId('folder-menu').getByRole('menuitem').first().click();
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.locator('.term-host.active').click();
    await page.keyboard.type('touch yeni-klasorde\n');
    await expect.poll(() => exists(join(one, 'yeni-klasorde'))).toBe(true);
  } finally {
    await app.close();
  }
});
