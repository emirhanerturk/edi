import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addRemote, launch, makeRepo, tmpDir } from './helpers.js';

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
