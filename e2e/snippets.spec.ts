import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

const exists = (path: string) => access(path).then(() => true, () => false);

/** The native question can't be clicked: the next ones answer `response`. */
async function questionsAnswer(app: ElectronApplication, response: number) {
  await app.evaluate(({ dialog }, answer) => {
    dialog.showMessageBox = (async () => ({ response: answer, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, response);
}

test('a snippet saved with the project runs in a new tab named after it, in its repository, line by line', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await makeRepo(dir, 'beta');
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.getByTestId('snippets-button').click();
    await page.getByTestId('new-snippet').click();
    await page.getByLabel('NAME', { exact: true }).fill('Make markers');
    await page.getByRole('button', { name: 'Runs in Project folder' }).click();
    await page.getByRole('menuitem', { name: /alpha/ }).click();
    await page.getByLabel('COMMAND', { exact: true }).fill('touch first-marker\ntouch second-marker');
    await page.getByRole('button', { name: 'Save snippet' }).click();
    await expect(page.getByTestId('snippet-sheet')).toHaveCount(0);

    await page.getByTestId('snippets-button').click();
    await page.getByTestId('snippet-row').filter({ hasText: 'Make markers' }).locator('.snippet-item').click();
    await expect(page.getByTestId('tab')).toHaveCount(2);
    await expect(page.getByTestId('tab').nth(1)).toHaveAttribute('data-snippet', 'true');
    await expect(page.getByTestId('tab').nth(1)).toContainText('Make markers');
    await expect.poll(() => exists(join(alpha, 'first-marker'))).toBe(true);
    await expect.poll(() => exists(join(alpha, 'second-marker'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('a snippet marked "Ask before running" runs only after a yes', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByTestId('snippets-button').click();
    await page.getByTestId('new-snippet').click();
    await page.getByLabel('NAME', { exact: true }).fill('Careful');
    await page.getByLabel('COMMAND', { exact: true }).fill('touch careful-marker');
    await page.getByText('Ask before running').click();
    await page.getByRole('button', { name: 'Save snippet' }).click();

    await questionsAnswer(app, 1);
    await page.getByTestId('snippets-button').click();
    await page.getByTestId('snippet-row').filter({ hasText: 'Careful' }).locator('.snippet-item').click();
    await expect(page.getByTestId('tab')).toHaveCount(1);

    await questionsAnswer(app, 0);
    await page.getByTestId('snippets-button').click();
    await page.getByTestId('snippet-row').filter({ hasText: 'Careful' }).locator('.snippet-item').click();
    await expect(page.getByTestId('tab')).toHaveCount(2);
    await expect.poll(() => exists(join(dir, 'careful-marker'))).toBe(true);
  } finally {
    await app.close();
  }
});
