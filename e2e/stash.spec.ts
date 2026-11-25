import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { git, launch, makeRepo, tmpDir } from './helpers.js';

const status = async (repo: string) => (await git(repo, 'status', '--porcelain')).split('\n').filter(Boolean).sort();
const stashes = async (repo: string) => (await git(repo, 'stash', 'list', '--format=%gs')).split('\n').filter(Boolean);

/** The native menus and questions can't be clicked: the next menu picks `label`, the next question answers `response`. */
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

test('several repos: stash with a message, see it in the stash view, pop it back as it was, drop another', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  const beta = await makeRepo(dir, 'beta');
  // beta is clean but has a stash made in a terminal.
  await writeFile(join(beta, 'README.md'), 'parked\n');
  await git(beta, 'stash', '-q');
  // alpha: a staged change, an unstaged one and a new file in a new folder.
  await writeFile(join(alpha, 'a.txt'), 'a\n');
  await git(alpha, 'add', 'a.txt');
  await git(alpha, 'commit', '-q', '-m', 'feat: a');
  await writeFile(join(alpha, 'README.md'), 'staged\n');
  await git(alpha, 'add', 'README.md');
  await writeFile(join(alpha, 'a.txt'), 'unstaged\n');
  await mkdir(join(alpha, 'notes'));
  await writeFile(join(alpha, 'notes', 'todo.txt'), 'todo\n');
  const before = await status(alpha);
  const { app, page } = await launch({ openDir: dir });
  try {
    const alphaRow = page.locator('[data-testid="repo-row"][data-repo="alpha"]');
    const betaRow = page.locator('[data-testid="repo-row"][data-repo="beta"]');
    await expect(betaRow).toHaveAttribute('aria-expanded', 'false');
    await expect(betaRow.getByTestId('repo-stashes')).toHaveText('1');

    await alphaRow.getByTestId('stash-button').click();
    await page.getByLabel('Stash message').fill('wip: login form');
    await page.getByLabel('Stash message').press('Enter');
    // Clean now: with several repos it collapses, and its row counts the stash.
    await expect(alphaRow).toHaveAttribute('aria-expanded', 'false');
    await expect(alphaRow.getByTestId('repo-stashes')).toHaveText('1');
    expect(await status(alpha)).toEqual([]);
    expect(await stashes(alpha)).toEqual(['On main: wip: login form']);

    await alphaRow.getByTestId('repo-toggle').click();
    const rows = alphaRow.getByTestId('stash-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('wip: login form');
    await rows.first().click();
    const view = page.getByTestId('center-view');
    await expect(view).toHaveAttribute('data-kind', 'stash');
    await expect(page.getByTestId('stash-title')).toHaveText('wip: login form');
    await expect(view.getByTestId('commit-file')).toHaveCount(3);
    await expect(view.locator('.commit-file-letter')).toHaveText(['M', 'M', '?']);
    await expect(page.getByTestId('center-tab')).toContainText('wip: login form');

    // Pop: everything comes back as it was, staged files staged; the stash and its tab go.
    await page.getByTestId('stash-view-pop').click();
    await expect(page.getByTestId('center-tab')).toHaveCount(0);
    await expect(alphaRow.getByTestId('stash-row')).toHaveCount(0);
    await expect(alphaRow.locator('[data-testid="file-row"][data-group="staged"][data-path="README.md"]')).toBeVisible();
    expect(await status(alpha)).toEqual(before);
    expect(await stashes(alpha)).toEqual([]);

    // beta's stash: right-click, Drop…; the question is asked, and No keeps it.
    await betaRow.getByTestId('repo-toggle').click();
    await expect(betaRow.getByTestId('stash-row')).toHaveCount(1);
    await nextMenuPicks(app, 'Drop…');
    await questionsAnswer(app, 1);
    await betaRow.getByTestId('stash-row').click({ button: 'right' });
    await page.waitForTimeout(300);
    expect(await stashes(beta)).toHaveLength(1);
    await nextMenuPicks(app, 'Drop…');
    await questionsAnswer(app, 0);
    await betaRow.getByTestId('stash-row').click({ button: 'right' });
    await expect(betaRow.getByTestId('stash-row')).toHaveCount(0);
    expect(await stashes(beta)).toEqual([]);
    expect(await readFile(join(beta, 'README.md'), 'utf8')).toBe('readme\n');
  } finally {
    await app.close();
  }
});

test('a single repo: a refused switch offers "Stash and switch"; the stash waits, listed, and pops back', async () => {
  const repo = await makeRepo(await tmpDir(), 'solo');
  await git(repo, 'switch', '-q', '-c', 'feat/x');
  await writeFile(join(repo, 'README.md'), 'feat/x line\n');
  await git(repo, 'commit', '-q', '-am', 'feat: x');
  await git(repo, 'switch', '-q', 'main');
  await writeFile(join(repo, 'README.md'), 'my edit\n');
  const { app, page } = await launch({ openDir: repo });
  try {
    const row = page.getByTestId('repo-row');
    await page.getByTestId('branch-button').click();
    await page.getByRole('menuitem', { name: 'feat/x' }).click();
    await expect(page.getByTestId('error-box')).toContainText('would be overwritten by checkout');
    await page.getByTestId('stash-retry').click();
    await expect(page.getByTestId('branch-button')).toContainText('feat/x');
    await expect(page.getByTestId('error-box')).toHaveCount(0);
    // A single repo with stashes stays open, clean, with its stash listed and the branch it came from.
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(row.getByText('No changes')).toBeVisible();
    const stash = row.getByTestId('stash-row');
    await expect(stash).toHaveCount(1);
    await expect(stash.locator('.stash-wip')).toHaveText('WIP');
    await expect(stash.locator('.stash-branch')).toHaveText('main');
    expect((await git(repo, 'symbolic-ref', '--short', 'HEAD')).trim()).toBe('feat/x');

    // Back on main the branch label goes (it is this branch), and Pop brings the edit back.
    await page.getByTestId('branch-button').click();
    await page.getByRole('menuitem', { name: 'main' }).click();
    await expect(page.getByTestId('branch-button')).toContainText('main');
    await expect(stash.locator('.stash-branch')).toHaveCount(0);
    await stash.getByTestId('stash-pop').click();
    await expect(page.locator('[data-testid="file-row"][data-path="README.md"]')).toBeVisible();
    await expect(stash).toHaveCount(0);
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('my edit\n');
    expect(await stashes(repo)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('a pop that conflicts keeps the stash and shows the conflict; Pop waits until it is resolved', async () => {
  const repo = await makeRepo(await tmpDir(), 'solo');
  await writeFile(join(repo, 'README.md'), 'stashed\n');
  await git(repo, 'stash', 'push', '-q', '-m', 'mine');
  await writeFile(join(repo, 'README.md'), 'committed\n');
  await git(repo, 'commit', '-q', '-am', 'change');
  const { app, page } = await launch({ openDir: repo });
  try {
    const stash = page.getByTestId('stash-row');
    await expect(stash).toHaveCount(1);
    await stash.getByTestId('stash-pop').click();
    await expect(page.getByTestId('error-box')).toContainText('Applied with conflicts; the stash is kept');
    await expect(page.locator('[data-testid="file-row"][data-group="conflicts"]')).toHaveCount(1);
    await expect(stash).toHaveCount(1);
    await expect(stash.getByTestId('stash-pop')).toBeDisabled();
    expect(await stashes(repo)).toEqual(['On main: mine']);
  } finally {
    await app.close();
  }
});
