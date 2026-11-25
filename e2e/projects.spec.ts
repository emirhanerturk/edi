import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { askedDialogs, git, launch, makeRepo, tmpDir } from './helpers.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#98c379"/></svg>\n';
const exists = (path: string) => access(path).then(() => true, () => false);

/** A repo with a GitHub remote (never reached: only its URL is read) and a logo in it. */
async function quizei(): Promise<string> {
  const repo = await makeRepo(await tmpDir(), 'quizei');
  await git(repo, 'remote', 'add', 'origin', 'git@github.com:quizei/app.git');
  await mkdir(join(repo, 'public'), { recursive: true });
  await writeFile(join(repo, 'public', 'logo.svg'), SVG);
  return repo;
}

test('edi <folder> for a new folder: the sheet offers its logo and repository page; the project opens with them', async () => {
  const repo = await quizei();
  const { app, page, userData } = await launch({ args: [`--open=${repo}`] });
  try {
    const sheet = page.getByTestId('project-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('sheet-folder')).toContainText(basename(repo));
    await expect(sheet.getByLabel('NAME')).toHaveValue('quizei');
    await expect(sheet.getByText('1 git repository found')).toBeVisible();
    // The logo found in the folder is offered and picked; its image comes from edi itself.
    const found = sheet.getByRole('button', { name: 'public/logo.svg' });
    await expect(found).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => found.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(sheet.getByLabel('Link 1 address')).toHaveValue('https://github.com/quizei/app');
    await expect(sheet.getByLabel('Link 1 label')).toHaveValue('GitHub');

    await sheet.getByLabel('NAME').fill('Quizei');
    await sheet.getByRole('button', { name: 'Add link' }).click();
    await sheet.getByLabel('Link 2 address').fill('quizei.com');
    await sheet.getByLabel('Link 2 label').fill('Site');
    await sheet.getByRole('button', { name: 'Make link 2 the main link' }).click();
    await sheet.getByRole('button', { name: 'Create project' }).click();
    await expect(sheet).toHaveCount(0);

    // The project is open: its logo and name, its main link written out, the other behind +1.
    await expect(page.getByTestId('statusbar')).toContainText('1 repository');
    await expect(page.getByTestId('project-button')).toContainText('Quizei');
    await expect.poll(() => page.getByTestId('project-button').locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByTestId('main-link')).toHaveText('quizei.com');
    await page.getByTestId('links-more').click();
    await expect(page.getByTestId('links-menu')).toContainText('GitHub');
    await expect(page.getByTestId('links-menu')).toContainText('github.com');

    // edi keeps its own copy of the logo; the state file names it.
    const logos = await readdir(join(userData, 'logos'));
    expect(logos).toHaveLength(1);
    expect(await readFile(join(userData, 'logos', logos[0]!), 'utf8')).toBe(SVG);
    const state = JSON.parse(await readFile(join(userData, 'state.json'), 'utf8'));
    expect(state.projects).toEqual([
      expect.objectContaining({
        dir: repo,
        name: 'Quizei',
        logo: { kind: 'image', file: logos[0] },
        links: [
          { url: 'https://quizei.com/', label: 'Site' },
          { url: 'https://github.com/quizei/app', label: 'GitHub' },
        ],
        repoCount: 1,
      }),
    ]);
  } finally {
    await app.close();
  }
});

test('Edit project… renames it and changes its links; the title bar follows', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('project-button')).toContainText(basename(dir));
    await expect(page.getByTestId('main-link')).toHaveCount(0);

    await page.getByTestId('project-button').click();
    await page.getByTestId('project-menu').getByRole('menuitem', { name: 'Edit project…' }).click();
    const sheet = page.getByTestId('project-sheet');
    await expect(sheet.getByRole('heading', { name: 'Edit project' })).toBeVisible();
    // The open project stays in its folder.
    await expect(sheet.getByRole('button', { name: 'Change…' })).toHaveCount(0);
    await sheet.getByLabel('NAME').fill('Alpha Studio');
    await sheet.getByRole('button', { name: 'Letter' }).click();
    await sheet.getByRole('button', { name: 'Orange' }).click();
    await sheet.getByRole('button', { name: 'Add link' }).click();
    await sheet.getByLabel('Link 1 address').fill('alpha.example');
    await sheet.getByRole('button', { name: 'Add link' }).click();
    await sheet.getByLabel('Link 2 address').fill('not a link');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Not a web address: not a link');
    await sheet.getByLabel('Link 2 address').fill('admin.alpha.example');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    await expect(page.getByTestId('project-button')).toContainText('Alpha Studio');
    await expect(page.getByTestId('main-link')).toHaveText('alpha.example');
    await expect(page.getByTestId('links-more')).toHaveText('+1');
  } finally {
    await app.close();
  }
});

test('All projects (⇧⌘O) shows the Projects screen over the open project, which keeps running; Esc goes back', async () => {
  const one = await tmpDir();
  await makeRepo(one, 'alpha');
  const two = await tmpDir();
  await makeRepo(two, 'beta');
  const first = await launch({ openDir: two });
  await first.app.close();
  const { app, page } = await launch({ userData: first.userData, openDir: one });
  try {
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.locator('.term-host.active').click();
    await page.keyboard.press('Meta+Shift+o');
    const projects = page.getByTestId('projects');
    await expect(projects).toBeVisible();
    const cards = page.getByTestId('project-card');
    await expect(cards.nth(0)).toContainText(basename(one));
    await expect(cards.nth(0)).toContainText('Open');
    await expect(cards.nth(1)).not.toContainText('Last opened');

    // The title bar's menus open over it: were the menu under the screen, the screen would take the click.
    await page.getByTestId('project-button').click();
    await page.getByTestId('project-menu').getByRole('menuitem', { name: /All projects/ }).click();
    await expect(page.getByTestId('project-menu')).toHaveCount(0);
    await expect(projects).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(projects).toHaveCount(0);
    // The terminal was never closed.
    await expect(page.getByTestId('tab')).toHaveCount(1);

    // From the menu too; picking the other project switches to it.
    await page.getByTestId('project-button').click();
    await page.getByTestId('project-menu').getByRole('menuitem', { name: /All projects/ }).click();
    await cards.nth(1).getByRole('button').first().click();
    await expect(projects).toHaveCount(0);
    await expect(page.getByTestId('project-button')).toContainText(basename(two));
    await expect(page.getByText('beta')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a project whose folder is gone says so; Remove from list forgets it and leaves the disk alone', async () => {
  const kept = await tmpDir();
  await makeRepo(kept, 'alpha');
  const gone = join(await tmpDir(), 'moved-away');
  const first = await launch({ openDir: kept });
  await first.app.close();
  // A second project whose folder has since moved.
  const file = join(first.userData, 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  state.projects.push({ id: 'gone-project', dir: gone, name: 'Gone', logo: { kind: 'letter', color: 'blue' }, links: [], openedAt: 1, repoCount: 2 });
  await writeFile(file, JSON.stringify(state));

  const { app, page } = await launch({ userData: first.userData });
  try {
    const card = page.getByTestId('project-card').filter({ hasText: 'Gone' });
    await expect(card).toContainText('Folder not found');
    await card.getByRole('button', { name: 'Remove from list' }).click();
    await expect(card).toHaveCount(0);
    expect((await askedDialogs(app)).map((asked) => asked.message)).toEqual(['Remove "Gone" from the list?']);
    await expect(page.getByTestId('project-card')).toHaveCount(1);
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).projects.length).toBe(1);
    expect(await exists(kept)).toBe(true);
  } finally {
    await app.close();
  }
});

test('removing the open project closes it, asking first while a terminal is busy', async () => {
  const dir = await tmpDir();
  await makeRepo(dir, 'alpha');
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.locator('.term-host.active').click();
    await page.keyboard.type('sleep 60\n');
    await expect(page.getByTestId('tab')).toContainText('sleep', { timeout: 10_000 });

    await page.getByTestId('project-button').click();
    await page.getByTestId('project-menu').getByRole('menuitem', { name: 'Edit project…' }).click();
    await page.getByTestId('project-sheet').getByRole('button', { name: 'Remove from list' }).click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByTestId('project-card')).toHaveCount(0);
    expect((await askedDialogs(app)).map((asked) => asked.message)).toEqual([`Remove "${basename(dir)}" from the list?`, 'Close the project?']);
    expect(await exists(join(dir, 'alpha'))).toBe(true);
  } finally {
    await app.close();
  }
});
