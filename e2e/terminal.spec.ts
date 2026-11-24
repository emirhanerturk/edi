import { access, symlink, writeFile } from 'node:fs/promises';
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

test('sekme önde çalışan komutun adını alır ve kapatılırken sorar', async () => {
  const dir = await tmpDir();
  const { app, page } = await launch({ openDir: dir });
  try {
    const tab = page.getByTestId('tab');
    await expect(tab).toContainText('sh');
    await page.locator('.term-host.active').click();
    await page.keyboard.type('sleep 300\n');
    await expect(tab).toContainText('sleep 300', { timeout: 10_000 });

    // İlk soruya hayır: sekme kalır. İkincisine evet: kapanır.
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

test('arka plandaki Claude sekmesi beklemeye geçince zil görünür, sekmeye dönünce kaybolur', async () => {
  const dir = await tmpDir();
  // Adı "claude" olan zararsız bir süreç (dash'e sembolik bağ): başlığı önce "çalışıyor", sonra "bekliyor" yapar.
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
