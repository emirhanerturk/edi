import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { git, launch, makeRepo, tmpDir } from './helpers.js';

const fileRow = (page: Page, path: string) => page.locator(`[data-testid="file-row"][data-path="${path}"]`).first();
const centerTabs = (page: Page) => page.getByTestId('center-tab');

/** A repo with one commit, with README.md and src/app.ts changed. */
async function repoWithChanges(dir: string): Promise<string> {
  const repo = await makeRepo(dir, 'alpha');
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'app.ts'), 'const a = 1;\nexport default a;\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'feat: app');
  await writeFile(join(repo, 'README.md'), 'new readme\n');
  await writeFile(join(repo, 'src', 'app.ts'), 'const a = 2;\nexport default a;\n');
  return repo;
}

test('clicking a changed file opens its diff', async () => {
  const dir = await tmpDir();
  const repo = await repoWithChanges(dir);
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('file-row')).toHaveCount(2);
    // The center panel starts closed.
    await expect(page.getByTestId('center-view')).toHaveCount(0);

    await fileRow(page, 'README.md').click();
    const view = page.getByTestId('center-view');
    await expect(view).toHaveAttribute('data-kind', 'diff');
    // The left and center panels share a background: a visible line separates them.
    expect(await page.locator('.terminals').evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe('1px');
    await expect(centerTabs(page)).toHaveCount(1);
    await expect(centerTabs(page)).toHaveAttribute('data-preview', 'true');
    const header = page.getByTestId('view-header');
    await expect(header).toContainText('alpha');
    await expect(header).toContainText('README.md');
    await expect(header).toContainText('+1 −1');
    await expect(view.locator('[data-side="old"][data-kind="del"]')).toHaveText('1−readme');
    await expect(view.locator('[data-side="new"][data-kind="add"]')).toHaveText('1+new readme');
    await expect(fileRow(page, 'README.md')).toHaveAttribute('aria-current', 'true');

    // A second single click reuses the same preview tab.
    await fileRow(page, 'src/app.ts').click();
    await expect(centerTabs(page)).toHaveCount(1);
    await expect(centerTabs(page)).toContainText('app.ts');
    await expect(view.locator('[data-side="new"][data-kind="add"]')).toHaveText('1+const a = 2;');
    // Syntax colors arrive: the line text is split into colored spans.
    await expect(view.locator('[data-side="new"][data-kind="add"] .code span').first()).toBeVisible();

    // A double click keeps the tab; the next single click opens a second tab.
    await fileRow(page, 'src/app.ts').dblclick();
    await expect(centerTabs(page)).toHaveAttribute('data-preview', 'false');
    await fileRow(page, 'README.md').click();
    await expect(centerTabs(page)).toHaveCount(2);

    // Closing the panel keeps the tabs: clicking a file brings both back.
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(view).toHaveCount(0);
    await fileRow(page, 'src/app.ts').click();
    await expect(centerTabs(page)).toHaveCount(2);
    await expect(centerTabs(page).first()).toHaveAttribute('aria-selected', 'true');

    // When the file changes on disk, the open diff refreshes by itself.
    await writeFile(join(repo, 'src', 'app.ts'), 'const a = 3;\nexport default a;\n');
    await expect(view.locator('[data-side="new"][data-kind="add"]')).toHaveText('1+const a = 3;', { timeout: 10_000 });

    // The stage button does not open the file; it only stages it.
    await fileRow(page, 'README.md').getByTestId('stage-file').click();
    await expect(page.locator('[data-testid="file-row"][data-group="staged"]')).toHaveCount(1);
    await expect(centerTabs(page).first()).toHaveAttribute('aria-selected', 'true');

    // Closing the last tab closes the panel too.
    const closeTab = page.locator('.center [role="tab"][aria-selected="true"]').getByRole('button', { name: 'Close tab' });
    await closeTab.click();
    await closeTab.click();
    await expect(view).toHaveCount(0);
    await expect(page.getByRole('separator', { name: 'Resize the terminal panel' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the diff layout and the left panel width persist across relaunches', async () => {
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
    await expect(view.locator('[data-testid="diff-row"][data-kind="add"]')).toHaveText('1+new readme');

    const box = await first.page.getByRole('separator', { name: 'Resize the terminal panel' }).boundingBox();
    if (!box) throw new Error('no divider');
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

test('a diff opens in a repo with no commits and for a deleted file', async () => {
  const dir = await tmpDir();
  const fresh = join(dir, 'fresh');
  await mkdir(fresh);
  await git(fresh, 'init', '-q', '-b', 'main');
  await writeFile(join(fresh, 'first.txt'), 'one\ntwo\n');
  await git(fresh, 'add', '-A');
  const repo = await makeRepo(dir, 'alpha');
  await git(repo, 'rm', '-q', 'README.md');
  const { app, page } = await launch({ openDir: dir });
  try {
    await fileRow(page, 'first.txt').click();
    await expect(page.getByTestId('view-header')).toContainText('+2 −0');
    await fileRow(page, 'README.md').click();
    await expect(page.getByTestId('view-header')).toContainText('+0 −1');
    await expect(page.getByTestId('center-view').locator('[data-side="new"][data-kind="empty"]')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('a file opens from the Files tab', async () => {
  const dir = await tmpDir();
  const repo = await repoWithChanges(dir);
  await makeRepo(dir, 'beta');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await mkdir(join(repo, 'node_modules', 'x'), { recursive: true });
  await writeFile(join(repo, 'node_modules', 'x', 'index.js'), 'x\n');
  await writeFile(join(repo, 'src', 'large ü.txt'), 'a'.repeat(2 * 1_048_576));
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
    // A folder matched by .gitignore is dimmed; opening it reads its contents, which are dimmed too.
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

    // A large file's content is not loaded (the name also covers spaces and non-ASCII letters).
    await row('large ü.txt').click();
    await expect(view.getByText('This file is too large to show (2.0 MB)')).toBeVisible();

    // Collapse everything.
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.getByTestId('tree-row')).toHaveCount(2);

    // When the file changes on disk, the open view refreshes.
    await row('alpha').click();
    await row('src').click();
    await row('app.ts').click();
    await writeFile(join(repo, 'src', 'app.ts'), 'const a = 4;\n');
    await expect(view.getByTestId('file-line')).toHaveText(['1const a = 4;'], { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('clicking a new file in the Git tab opens its content marked "new file"', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await writeFile(join(repo, 'new.md'), '# Title\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await fileRow(page, 'new.md').click();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'file');
    await expect(page.getByTestId('view-header').getByText('new file')).toBeVisible();
    await expect(page.getByTestId('file-line')).toHaveText(['1# Title']);
    await expect(page.getByTestId('center-info')).toHaveText('Markdown · 1 line');
  } finally {
    await app.close();
  }
});

test('when the open folder is a single repo, the Files tree starts with its contents', async () => {
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

test('the whole file opens from the diff view in a separate tab; the diff stays', async () => {
  const dir = await tmpDir();
  await repoWithChanges(dir);
  const { app, page } = await launch({ openDir: dir });
  try {
    await fileRow(page, 'README.md').click();
    const view = page.getByTestId('center-view');
    await expect(view).toHaveAttribute('data-kind', 'diff');
    await page.getByTestId('view-header').getByRole('button', { name: 'Open file' }).click();
    await expect(view).toHaveAttribute('data-kind', 'file');
    await expect(view.getByTestId('file-line')).toHaveText(['1new readme']);
    await expect(centerTabs(page)).toHaveCount(2);
    // Pointer cursor over the tabs.
    expect(await centerTabs(page).first().evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
  } finally {
    await app.close();
  }
});

test('an image opened from the Files tab is previewed; the video URL serves byte ranges; other files are refused', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await mkdir(join(repo, 'assets'));
  // A 1x1 pixel PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await writeFile(join(repo, 'assets', 'logo.png'), png);
  await writeFile(join(repo, 'assets', 'intro.mp4'), Buffer.from('0123456789'));
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByRole('tab', { name: 'Files' }).click();
    const row = (name: string) => page.locator(`[data-testid="tree-row"][data-name="${name}"]`);
    await row('alpha').click();
    await row('assets').click();
    await row('logo.png').click();
    const image = page.getByRole('img', { name: 'logo.png' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
    await expect(page.getByTestId('center-info')).toHaveText(`PNG image · ${png.length} B`);

    // The page cannot make network requests (CSP connect-src 'none'); the URL is only for <img>/<video>.
    const src = (await image.getAttribute('src'))!;
    const blocked = await page.evaluate(async (url) => fetch(url).then(() => 'loaded', () => 'blocked'), src);
    expect(blocked).toBe('blocked');

    // The handler in the main process: byte ranges for video, 404 for anything that is not media.
    const swap = (path: string) => src.replace(encodeURIComponent('assets/logo.png'), encodeURIComponent(path));
    const part = await app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url, { headers: { Range: 'bytes=2-4' } });
      return [response.status, response.headers.get('content-range'), await response.text()];
    }, swap('assets/intro.mp4'));
    expect(part).toEqual([206, 'bytes 2-4/10', '234']);
    expect(await app.evaluate(async ({ net }, url) => (await net.fetch(url)).status, swap('README.md'))).toBe(404);
  } finally {
    await app.close();
  }
});
