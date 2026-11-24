import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

const row = (page: Page, name: string) => page.locator(`[data-testid="tree-row"][data-name="${name}"]`);
const exists = (path: string) => access(path).then(() => true, () => false);

/** The native menus and dialogs can't be clicked: the next menu picks `label`, the next question answers `response`. */
async function nextMenuPicks(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu }, pick) => {
    Menu.prototype.popup = function (this: Electron.Menu, options?: Electron.PopupOptions) {
      this.items.find((item) => item.label === pick)?.click();
      options?.callback?.();
    };
  }, label);
}
async function questionsAnswer(app: ElectronApplication, response: number) {
  await app.evaluate(({ dialog }, answer) => {
    dialog.showMessageBox = (async () => ({ response: answer, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, response);
}

test('Files tab: new folder and file, rename and move to the Trash', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'taken.ts'), 'x\n');
  const { app, page } = await launch({ openDir: dir });
  // Nothing goes to the real Trash or Finder: the paths are recorded instead.
  await app.evaluate(({ shell }) => {
    const seen: string[] = [];
    (globalThis as { seen?: string[] }).seen = seen;
    shell.trashItem = async (path: string) => void seen.push(`trash ${path}`);
    shell.showItemInFolder = (path: string) => void seen.push(`reveal ${path}`);
  });
  const seen = () => app.evaluate(() => (globalThis as { seen?: string[] }).seen ?? []);
  try {
    await page.getByRole('tab', { name: 'Files' }).click();
    await row(page, 'alpha').click();

    // New Folder from the repo row: an empty folder still shows.
    await row(page, 'alpha').hover();
    await row(page, 'alpha').getByRole('button', { name: 'New Folder' }).click();
    await page.getByRole('textbox', { name: 'New folder name' }).fill('docs');
    await page.keyboard.press('Enter');
    await expect(row(page, 'docs')).toBeVisible();
    expect(await exists(join(repo, 'docs'))).toBe(true);

    // New File in it: it opens in the editor.
    await row(page, 'docs').hover();
    await row(page, 'docs').getByRole('button', { name: 'New File' }).click();
    await page.getByRole('textbox', { name: 'New file name' }).fill('notes.md');
    await page.keyboard.press('Enter');
    await expect(row(page, 'notes.md')).toBeVisible();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'file');
    await expect(page.getByTestId('center-tab').filter({ hasText: 'notes.md' })).toHaveCount(1);
    expect(await exists(join(repo, 'docs', 'notes.md'))).toBe(true);

    // A taken name is refused, with the reason under the field; Escape cancels.
    await row(page, 'src').click();
    await nextMenuPicks(app, 'New File…');
    await row(page, 'src').click({ button: 'right' });
    await page.getByRole('textbox', { name: 'New file name' }).fill('taken.ts');
    await page.keyboard.press('Enter');
    await expect(page.getByText('A file or folder named taken.ts already exists')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'New file name' })).toHaveCount(0);

    // Rename from the right-click menu: the open tab follows the file.
    await nextMenuPicks(app, 'Rename…');
    await row(page, 'notes.md').click({ button: 'right' });
    const rename = page.getByRole('textbox', { name: 'Rename notes.md' });
    await expect(rename).toHaveValue('notes.md');
    await rename.fill('readme.md');
    await page.keyboard.press('Enter');
    await expect(row(page, 'readme.md')).toBeVisible();
    await expect(row(page, 'notes.md')).toHaveCount(0);
    expect(await exists(join(repo, 'docs', 'readme.md'))).toBe(true);
    await expect(page.getByTestId('center-tab').filter({ hasText: 'readme.md' })).toHaveCount(1);
    await expect(page.getByTestId('center-tab').filter({ hasText: 'notes.md' })).toHaveCount(0);

    // Reveal in Finder.
    await nextMenuPicks(app, 'Reveal in Finder');
    await row(page, 'readme.md').click({ button: 'right' });
    await expect.poll(seen).toEqual([expect.stringMatching(/^reveal .*\/docs\/readme\.md$/)]);

    // Move to Trash: Cancel keeps it; confirming trashes it and closes its tab.
    await questionsAnswer(app, 1);
    await nextMenuPicks(app, 'Move to Trash');
    await row(page, 'readme.md').click({ button: 'right' });
    await page.waitForTimeout(300);
    expect(await seen()).toHaveLength(1);
    await questionsAnswer(app, 0);
    await nextMenuPicks(app, 'Move to Trash');
    await row(page, 'readme.md').click({ button: 'right' });
    await expect.poll(seen).toEqual([expect.stringMatching(/^reveal /), expect.stringMatching(/^trash .*\/docs\/readme\.md$/)]);
    await expect(page.getByTestId('center-tab').filter({ hasText: 'readme.md' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
