import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { git, launch, makeRepo, tmpDir } from './helpers.js';

const fileRow = (page: Page, path: string) => page.locator(`[data-testid="file-row"][data-path="${path}"]`).first();
const centerTabs = (page: Page) => page.getByTestId('center-tab');

/** README.md ve src/app.ts değişmiş, bir commit'i olan repo. */
async function repoWithChanges(dir: string): Promise<string> {
  const repo = await makeRepo(dir, 'alpha');
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'app.ts'), 'const a = 1;\nexport default a;\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'feat: app');
  await writeFile(join(repo, 'README.md'), 'yeni readme\n');
  await writeFile(join(repo, 'src', 'app.ts'), 'const a = 2;\nexport default a;\n');
  return repo;
}

test('değişen dosyaya tıklayınca diff açılır', async () => {
  const dir = await tmpDir();
  const repo = await repoWithChanges(dir);
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('file-row')).toHaveCount(2);
    // Orta panel kapalı başlar.
    await expect(page.getByTestId('center-view')).toHaveCount(0);

    await fileRow(page, 'README.md').click();
    const view = page.getByTestId('center-view');
    await expect(view).toHaveAttribute('data-kind', 'diff');
    await expect(centerTabs(page)).toHaveCount(1);
    await expect(centerTabs(page)).toHaveAttribute('data-preview', 'true');
    const header = page.getByTestId('view-header');
    await expect(header).toContainText('alpha');
    await expect(header).toContainText('README.md');
    await expect(header).toContainText('+1 −1');
    await expect(view.locator('[data-side="old"][data-kind="del"]')).toHaveText('1−readme');
    await expect(view.locator('[data-side="new"][data-kind="add"]')).toHaveText('1+yeni readme');
    await expect(fileRow(page, 'README.md')).toHaveAttribute('aria-current', 'true');

    // İkinci tek tık aynı önizleme sekmesini kullanır.
    await fileRow(page, 'src/app.ts').click();
    await expect(centerTabs(page)).toHaveCount(1);
    await expect(centerTabs(page)).toContainText('app.ts');
    await expect(view.locator('[data-side="new"][data-kind="add"]')).toHaveText('1+const a = 2;');
    // Sözdizimi renkleri gelir: satır metni renkli parçalara bölünür.
    await expect(view.locator('[data-side="new"][data-kind="add"] .code span').first()).toBeVisible();

    // Çift tık kalıcı yapar; sonraki tek tık ikinci sekmeyi açar.
    await fileRow(page, 'src/app.ts').dblclick();
    await expect(centerTabs(page)).toHaveAttribute('data-preview', 'false');
    await fileRow(page, 'README.md').click();
    await expect(centerTabs(page)).toHaveCount(2);

    // Paneli kapatmak sekmeleri silmez: bir dosyaya tıklayınca ikisi de geri gelir.
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(view).toHaveCount(0);
    await fileRow(page, 'src/app.ts').click();
    await expect(centerTabs(page)).toHaveCount(2);
    await expect(centerTabs(page).first()).toHaveAttribute('aria-selected', 'true');

    // Dosya diskte değişince açık diff kendiliğinden yenilenir.
    await writeFile(join(repo, 'src', 'app.ts'), 'const a = 3;\nexport default a;\n');
    await expect(view.locator('[data-side="new"][data-kind="add"]')).toHaveText('1+const a = 3;', { timeout: 10_000 });

    // Stage düğmesi dosyayı açmaz, yalnız stage eder.
    await fileRow(page, 'README.md').getByTestId('stage-file').click();
    await expect(page.locator('[data-testid="file-row"][data-group="staged"]')).toHaveCount(1);
    await expect(centerTabs(page).first()).toHaveAttribute('aria-selected', 'true');

    // Son sekme kapanınca panel de kapanır.
    const closeTab = page.locator('.center').getByRole('button', { name: 'Close tab' });
    await closeTab.click();
    await closeTab.click();
    await expect(view).toHaveCount(0);
    await expect(page.getByRole('separator', { name: 'Resize the terminal panel' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('diff düzeni seçimi ve sol panel genişliği yeniden açılışta korunur', async () => {
  const dir = await tmpDir();
  await repoWithChanges(dir);
  const first = await launch({ openDir: dir });
  const termWidth = (page: Page) => page.locator('.terminals').evaluate((el) => Math.round(el.getBoundingClientRect().width));
  try {
    await fileRow(first.page, 'README.md').click();
    const view = first.page.getByTestId('center-view');
    await expect(view.getByText('WORKING TREE')).toBeVisible();
    expect(await termWidth(first.page)).toBe(492);

    await first.page.getByRole('button', { name: 'Inline' }).click();
    await expect(view.getByText('WORKING TREE')).toHaveCount(0);
    await expect(view.locator('[data-testid="diff-row"][data-kind="del"]')).toHaveText('1−readme');
    await expect(view.locator('[data-testid="diff-row"][data-kind="add"]')).toHaveText('1+yeni readme');

    const box = await first.page.getByRole('separator', { name: 'Resize the terminal panel' }).boundingBox();
    if (!box) throw new Error('bölücü yok');
    const y = box.y + box.height / 2;
    await first.page.mouse.move(box.x + box.width / 2, y);
    await first.page.mouse.down();
    await first.page.mouse.move(box.x + box.width / 2 - 40, y, { steps: 4 });
    await first.page.mouse.up();
    expect(await termWidth(first.page)).toBe(452);
  } finally {
    await first.app.close();
  }

  const second = await launch({ openDir: dir, userData: first.userData });
  try {
    await fileRow(second.page, 'README.md').click();
    await expect(second.page.getByRole('button', { name: 'Inline' })).toHaveAttribute('aria-pressed', 'true');
    expect(await termWidth(second.page)).toBe(452);
  } finally {
    await second.app.close();
  }
});

test("commit'i olmayan repoda ve silinen dosyada diff açılır", async () => {
  const dir = await tmpDir();
  const fresh = join(dir, 'fresh');
  await mkdir(fresh);
  await git(fresh, 'init', '-q', '-b', 'main');
  await writeFile(join(fresh, 'ilk.txt'), 'bir\niki\n');
  await git(fresh, 'add', '-A');
  const repo = await makeRepo(dir, 'alpha');
  await git(repo, 'rm', '-q', 'README.md');
  const { app, page } = await launch({ openDir: dir });
  try {
    await fileRow(page, 'ilk.txt').click();
    await expect(page.getByTestId('view-header')).toContainText('+2 −0');
    await fileRow(page, 'README.md').click();
    await expect(page.getByTestId('view-header')).toContainText('+0 −1');
    await expect(page.getByTestId('center-view').locator('[data-side="new"][data-kind="empty"]')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
