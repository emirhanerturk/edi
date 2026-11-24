import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, _electron } from '@playwright/test';
import { makeRepo, tmpDir } from '../e2e/helpers.js';

const root = join(import.meta.dirname, '..');
const executable = join(root, 'release', `edi-darwin-${process.arch}`, 'edi.app', 'Contents', 'MacOS', 'edi');
const exists = (path: string) => access(path).then(() => true, () => false);

test('paketli uygulama: klasör argümanı, terminal, renklendirme ve giriş kabuğu ortamı', async () => {
  expect(await exists(executable), 'önce: npm run dist -- --no-install').toBe(true);
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'app.ts'), 'const a = 2;\nexport default a;\n');

  // Giriş kabuğu yerine geçen sahte kabuk: ortama bir işaret ekler.
  const shell = join(await tmpDir(), 'login-shell');
  await writeFile(shell, '#!/bin/sh\nfor a in "$@"; do last="$a"; done\nexport LOGIN_MARK=from-login\nexec /bin/sh -c "$last"\n');
  await chmod(shell, 0o755);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  Object.assign(env, { EDI_USER_DATA: await tmpDir('edi-dist-data-'), EDI_HIDDEN: '1', EDI_SHELL: '/bin/sh', SHELL: shell });

  const app = await _electron.launch({ executablePath: executable, args: [`--open=${dir}`], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('repo-row')).toHaveCount(1);

    // node-pty asar dışından yüklenir ve kabuk çalışır.
    await page.locator('.term-host.active').click();
    await page.keyboard.type('touch paketli-isaret\n');
    await expect.poll(() => exists(join(dir, 'paketli-isaret'))).toBe(true);

    // Shiki dil dosyaları paketin içinden yüklenir.
    await page.getByRole('tab', { name: 'Files' }).click();
    const row = (name: string) => page.locator(`[data-testid="tree-row"][data-name="${name}"]`);
    await row('alpha').click();
    await row('src').click();
    await row('app.ts').click();
    await expect(page.getByTestId('file-line')).toHaveCount(2);
    await expect.poll(() => page.locator('[data-testid="file-line"] span[style*="color"]').count()).toBeGreaterThan(0);

    // Giriş kabuğunun ortamı ana sürece eklendi.
    await expect.poll(() => app.evaluate(() => process.env.LOGIN_MARK ?? null)).toBe('from-login');
  } finally {
    await app.close();
  }
});
