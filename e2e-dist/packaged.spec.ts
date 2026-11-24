import { execFile } from 'node:child_process';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  // Her çağrıyı bir dosyaya yazar: devir için açılan ikinci kopya kabuğu çalıştırmamalı.
  const shellDir = await tmpDir();
  const shell = join(shellDir, 'login-shell');
  const calls = join(shellDir, 'calls.log');
  await writeFile(shell, `#!/bin/sh\necho call >> "${calls}"\nfor a in "$@"; do last="$a"; done\nexport LOGIN_MARK=from-login\nexec /bin/sh -c "$last"\n`);
  await chmod(shell, 0o755);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const data = await tmpDir('edi-dist-data-');
  Object.assign(env, { EDI_USER_DATA: data, EDI_HIDDEN: '1', EDI_SHELL: '/bin/sh', SHELL: shell, EDI_USAGE_FILE: join(data, 'claude-usage.json') });

  // Claude Code'un durum satırı ayarının göstereceği köprü betiği paketin içinde ve çalıştırılabilir.
  const statusline = join(root, 'release', `edi-darwin-${process.arch}`, 'edi.app', 'Contents', 'Resources', 'edi-statusline');
  await access(statusline, 1);

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

    // `edi <klasör>`: ikinci kopya klasörü devreder ve kapanır; giriş kabuğunu yeniden çalıştırmaz.
    const other = await tmpDir();
    await makeRepo(other, 'beta');
    const code = await new Promise<number>((resolve) =>
      execFile(executable, [`--open=${other}`], { env, timeout: 20_000 }, (error) => resolve(error ? Number(error.code ?? 1) : 0)),
    );
    expect(code).toBe(0);
    await expect(page.getByText('beta')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual(['call']);
  } finally {
    await app.close();
  }
});
