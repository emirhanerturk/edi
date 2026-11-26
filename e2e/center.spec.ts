import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

test('Cmd+W closes the tab of the panel in use: a file or diff in the center panel, the terminal in the terminals', async () => {
  const dir = await tmpDir();
  await repoWithChanges(dir);
  const { app, page } = await launch({ openDir: dir });
  try {
    const terminals = page.getByTestId('tab');
    await expect(terminals).toHaveCount(1);
    await page.locator('.term-host.active').click();

    // A diff opened from the Git tab: Cmd+W closes it, not the terminal typed in before.
    await fileRow(page, 'README.md').click();
    await expect(centerTabs(page)).toHaveCount(1);
    await page.keyboard.press('Meta+w');
    await expect(centerTabs(page)).toHaveCount(0);
    await expect(terminals).toHaveCount(1);

    // A click in the center panel counts as working there.
    await fileRow(page, 'README.md').dblclick();
    await fileRow(page, 'src/app.ts').dblclick();
    await expect(centerTabs(page)).toHaveCount(2);
    await page.locator('.term-host.active').click();
    await page.getByTestId('center-view').click({ position: { x: 30, y: 120 } });
    await page.keyboard.press('Meta+w');
    await expect(centerTabs(page)).toHaveCount(1);
    await expect(terminals).toHaveCount(1);

    // Back in the terminals, Cmd+W closes the terminal and leaves the file open.
    await page.keyboard.press('Meta+t');
    await expect(terminals).toHaveCount(2);
    await page.keyboard.press('Meta+w');
    await expect(terminals).toHaveCount(1);
    await expect(centerTabs(page)).toHaveCount(1);
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
    await expect.poll(() => editorLines(page)).toEqual(['x', '']);
    await row('node_modules').click();
    await expect(row('index.js')).toHaveCount(0);
    await row('src').click();
    await row('app.ts').click();

    const view = page.getByTestId('center-view');
    await expect(view).toHaveAttribute('data-kind', 'file');
    // A text file opens in the editor.
    await expect.poll(() => editorLines(page)).toEqual(['const a = 2;', 'export default a;', '']);
    await expect(row('app.ts')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('center-info')).toHaveText('TypeScript · 2 lines');

    // A large file's content is not loaded (the name also covers spaces and non-ASCII letters).
    await row('large ü.txt').click();
    await expect(view.getByText('This file is too large to show (2.0 MB)')).toBeVisible();
    await expect(page.getByTestId('view-header')).toContainText('Read-only');

    // Collapse everything.
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.getByTestId('tree-row')).toHaveCount(2);

    // When the file changes on disk, the open view refreshes.
    await row('alpha').click();
    await row('src').click();
    await row('app.ts').click();
    await writeFile(join(repo, 'src', 'app.ts'), 'const a = 4;\n');
    await expect.poll(() => editorLines(page), { timeout: 10_000 }).toEqual(['const a = 4;', '']);
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
    await expect.poll(() => editorLines(page)).toEqual(['# Title', '']);
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
    await expect.poll(() => editorLines(page)).toEqual(['new readme', '']);
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

/** The text in the file view's editor, line by line (Monaco shows spaces as no-break spaces). */
async function editorLines(page: Page): Promise<string[]> {
  return page.locator('[data-testid="file-editor"] .view-line').evaluateAll((lines) =>
    lines
      .map((line) => {
        // The muted "who changed this line" note isn't part of the text.
        const copy = line.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.edi-line-note').forEach((note) => note.remove());
        return { top: parseFloat((line as HTMLElement).style.top), text: (copy.textContent ?? '').replace(/\u00a0/g, ' ') };
      })
      .sort((a, b) => a.top - b.top)
      .map((line) => line.text),
  );
}

async function openFromFiles(page: Page, ...names: string[]) {
  await page.getByRole('tab', { name: 'Files' }).click();
  for (const name of names) await page.locator(`[data-testid="tree-row"][data-name="${name}"]`).click();
}

test('a file opened from the Files tab is editable; ⌘S saves it and the Git tab shows the change', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await writeFile(join(repo, 'app.ts'), 'const answer = 41;\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'feat: answer');
  const { app, page } = await launch({ openDir: dir });
  try {
    await openFromFiles(page, 'alpha', 'app.ts');
    const editor = page.getByTestId('file-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible();
    await expect.poll(() => editorLines(page)).toEqual(['const answer = 41;', '']);
    // Shiki colors, the same as the diff view: `const` in One Dark Pro's keyword purple.
    await expect
      .poll(() => editor.locator('.view-line span span').first().evaluate((el) => getComputedStyle(el).color))
      .toBe('rgb(198, 120, 221)');
    // No "Read-only" for a text file.
    await expect(page.getByTestId('view-header')).not.toContainText('Read-only');

    await editor.locator('.view-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('2;');
    await expect(page.getByTestId('view-header')).toContainText('Unsaved');
    const tab = centerTabs(page).first();
    await expect(tab).toHaveAttribute('data-unsaved', 'true');
    // The first edit pins the preview tab.
    await expect(tab).toHaveAttribute('data-preview', 'false');

    await page.keyboard.press('Meta+S');
    await expect(page.getByTestId('view-header')).not.toContainText('Unsaved');
    await expect(tab).not.toHaveAttribute('data-unsaved', 'true');
    await expect.poll(() => readFile(join(repo, 'app.ts'), 'utf8')).toBe('const answer = 42;\n');
    await page.getByRole('tab', { name: 'Git' }).click();
    await expect(page.getByTestId('file-row')).toHaveCount(1);
    await expect(tab.locator('.tab-letter')).toHaveText('M');
  } finally {
    await app.close();
  }
});

test('a clean editor takes the disk version; under unsaved edits a disk change shows a bar', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  const { app, page } = await launch({ openDir: dir });
  try {
    await openFromFiles(page, 'alpha', 'README.md');
    const editor = page.getByTestId('file-editor');
    await expect.poll(() => editorLines(page)).toEqual(['readme', '']);

    // An agent writes the file: the editor follows quietly.
    await writeFile(join(repo, 'README.md'), 'agent one\n');
    await expect.poll(() => editorLines(page)).toEqual(['agent one', '']);
    // Monaco has its own screen reader alerts: the bar is found by its class.
    await expect(page.locator('.edit-bar')).toHaveCount(0);

    // Now with my edit in progress.
    await editor.locator('.view-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' mine');
    await writeFile(join(repo, 'README.md'), 'agent two\n');
    const bar = page.locator('.edit-bar');
    await expect(bar).toContainText('This file changed on disk.');
    await expect.poll(() => editorLines(page)).toEqual(['agent one mine', '']);

    // Keep mine, then save: my text wins.
    await bar.getByRole('button', { name: 'Keep mine' }).click();
    await expect(bar).toHaveCount(0);
    await page.getByTestId('view-header').getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => readFile(join(repo, 'README.md'), 'utf8')).toBe('agent one mine\n');

    // Another conflict, resolved the other way.
    await editor.locator('.view-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await writeFile(join(repo, 'README.md'), 'agent three\n');
    await expect(bar).toContainText('This file changed on disk.');
    await bar.getByRole('button', { name: 'Load disk version' }).click();
    await expect.poll(() => editorLines(page)).toEqual(['agent three', '']);
    await expect(page.getByTestId('view-header')).not.toContainText('Unsaved');
  } finally {
    await app.close();
  }
});

test('edits survive switching tabs; closing an edited tab asks first', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await writeFile(join(repo, 'b.txt'), 'bee\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await openFromFiles(page, 'alpha', 'README.md');
    const editor = page.getByTestId('file-editor');
    await expect.poll(() => editorLines(page)).toEqual(['readme', '']);
    await editor.locator('.view-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' draft');
    await page.locator('[data-testid="tree-row"][data-name="b.txt"]').click();
    await expect.poll(() => editorLines(page)).toEqual(['bee', '']);
    await expect(centerTabs(page)).toHaveCount(2);
    await centerTabs(page).first().click();
    await expect.poll(() => editorLines(page)).toEqual(['readme draft', '']);

    // Cancel in the native question keeps the tab.
    await app.evaluate(({ dialog }) => {
      (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await centerTabs(page).first().getByRole('button', { name: 'Close tab (unsaved changes)' }).click();
    await expect(centerTabs(page)).toHaveCount(2);
    await app.evaluate(({ dialog }) => {
      (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await centerTabs(page).first().getByRole('button', { name: 'Close tab (unsaved changes)' }).click();
    await expect(centerTabs(page)).toHaveCount(1);
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('readme\n');
  } finally {
    await app.close();
  }
});

test('quitting with unsaved edits asks first', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const { app, page } = await launch({ openDir: dir });
  try {
    await openFromFiles(page, 'alpha', 'README.md');
    await expect.poll(() => editorLines(page)).toEqual(['readme', '']);
    await page.getByTestId('file-editor').locator('.view-line').first().click();
    await page.keyboard.type('x');
    await expect(centerTabs(page).first()).toHaveAttribute('data-unsaved', 'true');
    // Answer Cancel and remember what was asked.
    await app.evaluate(({ dialog }) => {
      const asked: unknown[] = [];
      (globalThis as { asked?: unknown[] }).asked = asked;
      (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async (...args: unknown[]) => {
        asked.push(args.at(-1));
        return { response: 1, checkboxChecked: false };
      };
    });
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await expect
      .poll(() => app.evaluate(() => (globalThis as { asked?: { message: string; detail: string }[] }).asked ?? []))
      .toEqual([expect.objectContaining({ message: 'Quit edi?', detail: '1 file has unsaved changes. They will be lost.' })]);
    // Still running.
    await expect(centerTabs(page)).toHaveCount(1);
  } finally {
    await app.evaluate(({ dialog }) => {
      (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
  }
});

test('the editor marks lines changed since HEAD and says who last changed the cursor line', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await writeFile(join(repo, 'app.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'feat: four constants');
  // Line 2 changed, a line added after line 3, line 4 removed.
  await writeFile(join(repo, 'app.ts'), 'const a = 1;\nconst b = 20;\nconst c = 3;\nconst e = 5;\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await openFromFiles(page, 'alpha', 'app.ts');
    const editor = page.getByTestId('file-editor');
    await expect.poll(() => editorLines(page)).toEqual(['const a = 1;', 'const b = 20;', 'const c = 3;', 'const e = 5;', '']);
    await expect(editor.locator('.edi-change-modified')).toHaveCount(2);
    await expect(editor.locator('.edi-change-added')).toHaveCount(0);

    // A new line above an unchanged one is added.
    // (Clicking a line number selects the line: the cursor goes to the start of the file instead.)
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Meta+ArrowUp');
    await page.keyboard.type('const z = 0;');
    await page.keyboard.press('Enter');
    await expect(editor.locator('.edi-change-added')).toHaveCount(1);

    // The cursor's line: a muted note with the author, when and the commit subject.
    await clickLine(page, 2);
    const note = editor.locator('.edi-line-note');
    // Monaco draws the note's spaces as no-break spaces.
    const noteText = () => note.evaluate((el) => (el.textContent ?? '').replace(/\u00a0/g, ' ').trim()).catch(() => '');
    await expect.poll(noteText).toContain('Test, just now · feat: four constants');
    await clickLine(page, 3);
    await expect.poll(noteText).toContain('Not committed yet');
    await clickLine(page, 1);
    await expect.poll(noteText).toContain('Not committed yet');

    // Clicking the note opens the commit; the file tab stays.
    await clickLine(page, 2);
    await expect.poll(noteText).toContain('feat: four constants');
    await note.click();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'commit');
    await expect(page.locator('.commit-title')).toContainText('four constants');
    await expect(centerTabs(page)).toHaveCount(2);
  } finally {
    await app.close();
  }
});

/**
 * Puts the cursor on a line (Monaco doesn't keep its line elements in order). Clicking a line number
 * selects the line, ending at the next one; Left moves the cursor back to the line's start.
 */
async function clickLine(page: Page, line: number) {
  await page.getByTestId('file-editor').locator('.line-numbers').getByText(String(line), { exact: true }).click();
  await page.keyboard.press('ArrowLeft');
}

test('a new untitled file: ⌘N or +, typed, saved through the Save panel into a repo, then a normal file tab', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  const { app, page } = await launch({ openDir: dir });
  const savePanelReturns = (filePath: string) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    }, filePath);
  try {
    // ⌘N works with the center panel closed.
    await page.locator('body').click();
    await page.keyboard.press('Meta+n');
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'untitled');
    await expect(centerTabs(page)).toHaveText(['Untitled-1']);
    await page.getByTestId('new-untitled').click();
    await expect(centerTabs(page)).toHaveText(['Untitled-1', 'Untitled-2']);

    const editor = page.getByTestId('file-editor');
    await editor.locator('.view-lines').click();
    await page.keyboard.type('# Notes');
    await expect(centerTabs(page).nth(1)).toHaveAttribute('data-unsaved', 'true');

    // Outside every repo: refused, the text stays.
    await savePanelReturns(join(dir, 'loose.md'));
    await page.keyboard.press('Meta+s');
    await expect(page.locator('.edit-bar')).toContainText('Save it inside one of the repositories in this folder');
    await expect.poll(() => editorLines(page)).toEqual(['# Notes']);

    await savePanelReturns(join(repo, 'notes.md'));
    await page.keyboard.press('Meta+s');
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'file');
    // A new, untracked file: its tab carries the "?" mark.
    await expect(centerTabs(page)).toHaveText(['Untitled-1', '?notes.md']);
    await expect(centerTabs(page).nth(1)).not.toHaveAttribute('data-unsaved', 'true');
    expect(await readFile(join(repo, 'notes.md'), 'utf8')).toBe('# Notes');
    await expect.poll(() => editorLines(page)).toEqual(['# Notes']);

    // An empty untitled tab closes without asking.
    await centerTabs(page).first().click();
    await centerTabs(page).first().getByRole('button', { name: 'Close tab' }).click();
    await expect(centerTabs(page)).toHaveText(['?notes.md']);
  } finally {
    await app.close();
  }
});

test('Quick open (⌘P) finds a file by name in any repository, opens it, and lists it as recent', async () => {
  const dir = await tmpDir();
  await repoWithChanges(dir);
  const beta = await makeRepo(dir, 'beta');
  await mkdir(join(beta, 'lib'));
  await writeFile(join(beta, 'lib', 'models.ts'), 'export {};\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.keyboard.press('Meta+p');
    const input = page.getByTestId('quick-open-input');
    await expect(input).toBeFocused();
    await input.fill('model');
    await expect(page.getByTestId('quick-open-group')).toHaveCount(1);
    await expect(page.getByTestId('quick-open-file')).toHaveText([/models\.ts/]);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('quick-open')).toHaveCount(0);
    await expect(centerTabs(page).filter({ hasText: 'models.ts' })).toHaveCount(1);
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'file');

    // Opened again with nothing typed, it lists the recent files; Escape closes it.
    await page.keyboard.press('Meta+p');
    await expect(page.getByText('RECENTLY OPENED')).toBeVisible();
    await expect(page.getByTestId('quick-open-file').first()).toContainText('models.ts');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('quick-open')).toHaveCount(0);

    // The file opened from it is in the panel in use: ⌘W closes it.
    await page.keyboard.press('Meta+w');
    await expect(centerTabs(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});
