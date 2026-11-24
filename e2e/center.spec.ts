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
    // Sol panel ile orta panelin zemini aynı: aralarında görünür bir çizgi vardır.
    expect(await page.locator('.terminals').evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe('1px');
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
    const closeTab = page.locator('.center [role="tab"][aria-selected="true"]').getByRole('button', { name: 'Close tab' });
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

test('Files sekmesinden dosya açılır', async () => {
  const dir = await tmpDir();
  const repo = await repoWithChanges(dir);
  await makeRepo(dir, 'beta');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await mkdir(join(repo, 'node_modules', 'x'), { recursive: true });
  await writeFile(join(repo, 'node_modules', 'x', 'index.js'), 'x\n');
  await writeFile(join(repo, 'src', 'büyük.txt'), 'a'.repeat(2 * 1_048_576));
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('repo-row')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Files' }).click();
    const row = (name: string) => page.locator(`[data-testid="tree-row"][data-name="${name}"]`);
    await expect(page.getByTestId('tree-row')).toHaveCount(2);
    await expect(row('alpha')).toHaveAttribute('data-badge', '●');
    await expect(row('beta')).toHaveAttribute('data-badge', '');

    await row('alpha').click();
    await expect(row('src')).toHaveAttribute('data-badge', '●');
    await expect(row('README.md')).toHaveAttribute('data-badge', 'M');
    // .gitignore'a takılan klasör soluk görünür; açılınca içi okunur, içindekiler de soluk.
    await expect(row('node_modules')).toHaveAttribute('data-ignored', 'true');
    await row('node_modules').click();
    await row('x').click();
    await expect(row('index.js')).toHaveAttribute('data-ignored', 'true');
    await row('index.js').click();
    await expect(page.getByTestId('center-view').getByTestId('file-line')).toHaveText(['1x']);
    await row('node_modules').click();
    await expect(row('index.js')).toHaveCount(0);
    await row('src').click();
    await row('app.ts').click();

    const view = page.getByTestId('center-view');
    await expect(view).toHaveAttribute('data-kind', 'file');
    await expect(page.getByTestId('view-header')).toContainText('Read-only');
    await expect(view.getByTestId('file-line')).toHaveText(['1const a = 2;', '2export default a;']);
    await expect(row('app.ts')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('center-info')).toHaveText('TypeScript · 2 lines');

    // Büyük dosyanın içeriği gelmez.
    await row('büyük.txt').click();
    await expect(view.getByText('This file is too large to show (2.0 MB)')).toBeVisible();

    // Hepsini kapat.
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.getByTestId('tree-row')).toHaveCount(2);

    // Dosya diskte değişince açık görünüm yenilenir.
    await row('alpha').click();
    await row('src').click();
    await row('app.ts').click();
    await writeFile(join(repo, 'src', 'app.ts'), 'const a = 4;\n');
    await expect(view.getByTestId('file-line')).toHaveText(['1const a = 4;'], { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('Git sekmesinde yeni dosyaya tıklayınca içeriği "new file" işaretiyle açılır', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await writeFile(join(repo, 'yeni.md'), '# Başlık\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await fileRow(page, 'yeni.md').click();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'file');
    await expect(page.getByTestId('view-header').getByText('new file')).toBeVisible();
    await expect(page.getByTestId('file-line')).toHaveText(['1# Başlık']);
    await expect(page.getByTestId('center-info')).toHaveText('Markdown · 1 line');
  } finally {
    await app.close();
  }
});

test('açık klasör tek bir repoysa Files ağacı doğrudan onun içeriğiyle başlar', async () => {
  const parent = await tmpDir();
  const repo = await makeRepo(parent, 'solo');
  const { app, page } = await launch({ openDir: repo });
  try {
    await page.getByRole('tab', { name: 'Files' }).click();
    await expect(page.getByTestId('tree-row')).toHaveText(['README.md']);
  } finally {
    await app.close();
  }
});
