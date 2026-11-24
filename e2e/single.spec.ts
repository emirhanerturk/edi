import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

const root = join(import.meta.dirname, '..');
const electron = join(root, 'node_modules', '.bin', 'electron');

/** `edi <klasör>` komutunun yaptığı gibi ikinci bir kopya başlatır; kopya klasörü devredip kapanır. */
function secondInstance(userData: string, args: string[]): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...process.env, EDI_USER_DATA: userData, EDI_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    execFile(electron, [root, ...args], { env, timeout: 20_000 }, (error) => resolve(error ? Number(error.code ?? 1) : 0));
  });
}

test('ikinci kopya klasörü açık pencereye devreder ve kendisi kapanır', async () => {
  const first = await tmpDir();
  await makeRepo(first, 'ilk-repo');
  const second = await tmpDir();
  await makeRepo(second, 'ikinci-repo');
  const { app, page, userData } = await launch({ openDir: first });
  try {
    await expect(page.getByText('ilk-repo')).toBeVisible();
    expect(await secondInstance(userData, [`--open=${second}`])).toBe(0);
    await expect(page.getByText('ikinci-repo')).toBeVisible();
    await expect(page.getByText('ilk-repo')).toHaveCount(0);
    expect(app.windows()).toHaveLength(1);
    // Testlerde gizli çalışan pencere devirde görünür olmaz.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false]);
  } finally {
    await app.close();
  }
});
