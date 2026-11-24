import { expect, test } from '@playwright/test';
import { launch } from './helpers.js';

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
