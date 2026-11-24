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
