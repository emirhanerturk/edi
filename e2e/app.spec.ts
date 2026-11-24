import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

test('pencere açılır ve başlıkta edi yazar', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByTestId('titlebar')).toContainText('edi');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(40, 44, 52)');
    // Sayfa Node'a erişemez; yalnız köprü nesnesi vardır.
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (window as unknown as { edi?: unknown }).edi)).toBe('object');
  } finally {
    await app.close();
  }
});

test('boş durumda Open a folder görünür', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByRole('heading', { name: 'Open a folder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose folder' })).toBeVisible();
    await expect(page.getByTestId('statusbar')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('klasör açılınca repo sayısı durum çubuğunda, adı başlıkta görünür', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const beta = await makeRepo(dir, 'beta');
  await writeFile(join(beta, 'yeni.txt'), 'x\n');

  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('statusbar')).toContainText('2 repositories');
    await expect(page.getByTestId('statusbar')).toContainText('1 with changes');
    await expect(page.getByTestId('folder-button')).toContainText(basename(dir));
    await expect(page.getByRole('heading', { name: 'Open a folder' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('son açılan klasör yeniden açılışta geri gelir, öncekiler menüde listelenir', async () => {
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

  // Klasör verilmeden açılış: son açılan (iki repolu) geri gelir.
  const third = await launch({ userData: first.userData });
  try {
    await expect(third.page.getByTestId('statusbar')).toContainText('2 repositories');
    await third.page.getByTestId('folder-button').click();
    const menu = third.page.getByTestId('folder-menu');
    await expect(menu).toContainText(basename(one));
    await expect(menu).toContainText('1 repo');
    await expect(menu).toContainText('Choose folder…');

    // Menüden önceki klasöre geçilir.
    await menu.getByRole('menuitem', { name: new RegExp(basename(one)) }).click();
    await expect(third.page.getByTestId('statusbar')).toContainText('1 repository');
    await expect(third.page.getByTestId('folder-button')).toContainText(basename(one));
  } finally {
    await third.app.close();
  }
});

/** Claude Code'un yaptığı gibi köprü betiğine durum JSON'u verir. */
function bridge(file: string, limits: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('/bin/sh', [join(import.meta.dirname, '..', 'resources', 'edi-statusline')], { env: { PATH: '/usr/bin:/bin', EDI_USAGE_FILE: file } }, (error) =>
      error ? reject(error) : resolve(),
    );
    child.stdin!.end(JSON.stringify({ cwd: '/x', rate_limits: limits }));
  });
}

test('Claude kullanım limitleri köprüden gelir, üst çubukta görünür ve değişince tazelenir', async () => {
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
    await bridge(file, { five_hour: { used_percentage: 93, resets_at: soon }, seven_day: { used_percentage: 20, resets_at: later } });
    await expect(windows.nth(0)).toContainText('93%', { timeout: 10_000 });
    await expect(windows.nth(0)).toHaveAttribute('data-level', 'high');
  } finally {
    await app.close();
  }
});

test('köprü kurulmamışsa kullanım göstergesi yoktur', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByTestId('titlebar')).toContainText('edi');
    await expect(page.getByTestId('usage')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
