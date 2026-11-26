import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { launch, makeRepo, nextMenuPicks, tmpDir } from './helpers.js';

/** The native question can't be clicked: the next one answers `response`, and its message is kept. */
async function questionsAnswer(app: ElectronApplication, response: number) {
  await app.evaluate(({ dialog }, answer) => {
    const asked: string[] = [];
    (globalThis as { asked?: string[] }).asked = asked;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { message?: string };
      asked.push(options.message ?? '');
      return { response: answer, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, response);
}

test('Search tab: finds text in every repository, opens a result and replaces after asking', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await writeFile(join(alpha, 'rank.ts'), 'const weeklyRank = 1;\n');
  const beta = await makeRepo(dir, 'beta');
  await writeFile(join(beta, 'notes.md'), 'weeklyRank here\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    // ⇧⌘F: the Search tab, the cursor in its field.
    await page.keyboard.press('Meta+Shift+f');
    const input = page.getByTestId('search-input');
    await expect(input).toBeFocused();
    await input.fill('weeklyRank');
    await expect(page.getByTestId('search-summary')).toHaveText('2 results in 2 files · 2 repositories');

    // A result opens the file.
    await page.getByTestId('search-line').first().click();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'file');

    // Replace all asks first, then writes both files.
    await page.getByRole('button', { name: 'Toggle Replace' }).click();
    await page.getByTestId('replace-input').fill('weekRank');
    await questionsAnswer(app, 0);
    await page.getByRole('button', { name: 'Replace all', exact: true }).click();
    await expect(page.getByTestId('search-done')).toContainText('2 occurrences replaced in 2 files');
    expect(await app.evaluate(() => (globalThis as { asked?: string[] }).asked)).toEqual(['Replace 2 occurrences of “weeklyRank” with “weekRank”?']);
    expect(await readFile(join(alpha, 'rank.ts'), 'utf8')).toBe('const weekRank = 1;\n');
    expect(await readFile(join(beta, 'notes.md'), 'utf8')).toBe('weekRank here\n');
  } finally {
    await app.close();
  }
});

test('Find in Folder… searches that folder of that repository', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await writeFile(join(alpha, 'top.ts'), 'needle\n');
  await mkdir(join(alpha, 'src'));
  await writeFile(join(alpha, 'src', 'deep.ts'), 'needle\n');
  await makeRepo(dir, 'beta');
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByRole('tab', { name: 'Files' }).click();
    const row = (name: string) => page.locator(`[data-testid="tree-row"][data-name="${name}"]`);
    await row('alpha').click();
    await nextMenuPicks(app, 'Find in Folder…');
    await row('src').click({ button: 'right' });
    await expect(page.getByRole('textbox', { name: 'Files to include' })).toHaveValue('src/**');
    await page.getByTestId('search-input').fill('needle');
    await expect(page.getByTestId('search-file')).toHaveCount(1);
    await expect(page.getByTestId('search-file')).toHaveAttribute('data-path', 'src/deep.ts');
  } finally {
    await app.close();
  }
});
