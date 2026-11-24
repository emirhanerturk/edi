import { execFile } from 'node:child_process';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, _electron } from '@playwright/test';
import { makeRepo, tmpDir } from '../e2e/helpers.js';

const root = join(import.meta.dirname, '..');
const executable = join(root, 'release', `edi-darwin-${process.arch}`, 'edi.app', 'Contents', 'MacOS', 'edi');
const exists = (path: string) => access(path).then(() => true, () => false);

test('packaged app: folder argument, terminal, syntax colors and login shell environment', async () => {
  expect(await exists(executable), 'run npm run dist -- --no-install first').toBe(true);
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'app.ts'), 'const a = 2;\nexport default a;\n');

  // A fake shell standing in for the login shell: adds a marker to the environment.
  // It logs every call to a file: the second instance started for the hand-over must not run the shell.
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

  // The bridge script that Claude Code's status line setting points to is in the bundle and executable.
  const statusline = join(root, 'release', `edi-darwin-${process.arch}`, 'edi.app', 'Contents', 'Resources', 'edi-statusline');
  await access(statusline, 1);

  const app = await _electron.launch({ executablePath: executable, args: [`--open=${dir}`], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('repo-row')).toHaveCount(1);

    // node-pty loads from outside the asar and the shell runs.
    await page.locator('.term-host.active').click();
    await page.keyboard.type('touch packaged-marker\n');
    await expect.poll(() => exists(join(dir, 'packaged-marker'))).toBe(true);

    // Shiki's language files load from inside the bundle.
    await page.getByRole('tab', { name: 'Files' }).click();
    const row = (name: string) => page.locator(`[data-testid="tree-row"][data-name="${name}"]`);
    await row('alpha').click();
    await row('src').click();
    await row('app.ts').click();
    await expect(page.getByTestId('file-line')).toHaveCount(2);
    await expect.poll(() => page.locator('[data-testid="file-line"] span[style*="color"]').count()).toBeGreaterThan(0);

    // The login shell's environment was added to the main process.
    await expect.poll(() => app.evaluate(() => process.env.LOGIN_MARK ?? null)).toBe('from-login');

    // `edi <folder>`: the second instance hands the folder over and quits; it does not run the login shell again.
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
