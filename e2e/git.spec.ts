import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addRemote, git, launch, makeRepo, tmpDir } from './helpers.js';

test('değişen dosya birkaç saniye içinde Git sekmesinde görünür', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await addRemote(await makeRepo(dir, 'beta'));
  await makeRepo(dir, 'gamma');
  const { app, page } = await launch({ openDir: dir });
  try {
    const rows = page.getByTestId('repo-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('file-row')).toHaveCount(0);

    await writeFile(join(alpha, 'README.md'), 'değişti\n');
    await writeFile(join(alpha, 'yeni.txt'), 'x\n');
    await expect(page.getByTestId('file-row')).toHaveCount(2, { timeout: 10_000 });
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('git-badge')).toHaveText('2');
    // Kapalı satırda tek eşitleme düğmesi: remote var, branch henüz yayınlanmamış.
    await expect(rows.nth(1).getByTestId('sync-button')).toHaveText('Publish branch');
    // Remote'u olmayan repoda yayınlanacak yer yok: düğme de yok.
    await expect(rows.nth(2).getByTestId('sync-button')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('stage edip commit edince repo temize döner', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await writeFile(join(alpha, 'README.md'), 'değişti\n');
  await writeFile(join(alpha, 'yeni.txt'), 'x\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    const row = page.getByTestId('repo-row');
    await expect(page.getByTestId('file-row')).toHaveCount(2);
    await expect(page.getByTestId('commit-button')).toHaveText('Commit all · 2 files');

    // Yalnız README stage edilir: düğme "Commit · 1 file" olur.
    await page.locator('[data-testid="file-row"][data-path="README.md"]').getByTestId('stage-file').click();
    await expect(page.getByTestId('commit-button')).toHaveText('Commit · 1 file');
    await expect(page.getByTestId('commit-button')).toBeDisabled();

    await page.getByTestId('commit-message').fill('docs: update the readme\n\nSecond paragraph.');
    await page.getByTestId('commit-button').click();
    await expect(page.getByTestId('file-row')).toHaveCount(1);
    await expect(page.getByTestId('commit-message')).toHaveValue('');
    expect(await git(alpha, 'log', '-1', '--format=%B')).toBe('docs: update the readme\n\nSecond paragraph.\n\n');
    expect(await git(alpha, 'status', '--porcelain')).toBe('?? yeni.txt\n');

    // Kalan dosya Cmd+Enter ile "Commit all" olarak commit edilir; repo temizlenir ve kapanır.
    await page.getByTestId('commit-message').fill('feat: add the new file');
    await page.getByTestId('commit-message').press('Meta+Enter');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByLabel('Clean')).toBeVisible();
    expect(await git(alpha, 'log', '-1', '--format=%s')).toBe('feat: add the new file\n');
  } finally {
    await app.close();
  }
});

test('Commit and push yerel remote\'a gönderir; kapalı satırdaki düğme push eder', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  const bare = await addRemote(alpha);
  await writeFile(join(alpha, 'yeni.txt'), 'x\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByTestId('commit-message').fill('feat: first');
    await page.getByLabel('Commit options').click();
    await page.getByRole('menuitem', { name: 'Commit and push' }).click();
    await expect(page.getByTestId('repo-row')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => git(bare, 'log', '-1', '--format=%s', 'main').catch(() => '')).toBe('feat: first\n');
    await expect(page.getByTestId('sync-button')).toHaveCount(0);

    // Terminalden atılmış gibi yeni bir commit: satırda "Push 1" çıkar, basınca gider.
    await writeFile(join(alpha, 'iki.txt'), 'x\n');
    await git(alpha, 'add', '-A');
    await git(alpha, 'commit', '-q', '-m', 'feat: second');
    await expect(page.getByTestId('sync-button')).toHaveText('Push 1', { timeout: 10_000 });
    await page.getByTestId('sync-button').click();
    // Düğme, işlem sürerken yerini "Pushing…" yazısına bırakır; bitince satır temiz görünür.
    await expect.poll(() => git(bare, 'log', '-1', '--format=%s', 'main')).toBe('feat: second\n');
    await expect(page.getByTestId('repo-row').getByLabel('Clean')).toBeVisible();
    await expect(page.getByTestId('sync-button')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('git hatası reponun altında gösterilir ve kapatılabilir; yeni branch açılır', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await writeFile(join(alpha, 'README.md'), 'değişti\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    // Var olan bir adla branch açmak git tarafından reddedilir.
    await page.getByTestId('branch-button').click();
    await page.getByRole('menuitem', { name: 'New branch…' }).click();
    await page.getByPlaceholder('Branch name').fill('main');
    await page.getByPlaceholder('Branch name').press('Enter');
    await expect(page.getByTestId('error-box')).toContainText("a branch named 'main' already exists");
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByTestId('error-box')).toHaveCount(0);

    await page.getByTestId('branch-button').click();
    await page.getByRole('menuitem', { name: 'New branch…' }).click();
    await page.getByPlaceholder('Branch name').fill('feat/new-thing');
    await page.getByPlaceholder('Branch name').press('Enter');
    await expect(page.getByTestId('branch-button')).toContainText('feat/new-thing');
    expect(await git(alpha, 'symbolic-ref', '--short', 'HEAD')).toBe('feat/new-thing\n');
    expect(await git(alpha, 'status', '--porcelain')).toBe(' M README.md\n'); // değişiklik yerinde

    // Menüden eski branch'e dönülür.
    await page.getByTestId('branch-button').click();
    await page.getByRole('menuitem', { name: 'main' }).click();
    await expect(page.getByTestId('branch-button')).toContainText('main');
  } finally {
    await app.close();
  }
});
