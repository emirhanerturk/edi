import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, makeRepo, tmpDir } from './helpers.js';

test('a server started in a terminal shows in the status bar and the tab, and goes away when it stops', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  // Listens on a free port between 40000 and 48999 and writes the port to a file (random ports
  // from listen(0) do not count as servers).
  await writeFile(
    join(repo, 'server.cjs'),
    [
      "const s = require('node:http').createServer();",
      "const tryListen = () => s.listen(40000 + Math.floor(Math.random() * 9000), '127.0.0.1');",
      "s.on('error', tryListen);",
      "s.on('listening', () => require('node:fs').writeFileSync('port.txt', String(s.address().port)));",
      'tryListen();',
      '',
    ].join('\n'),
  );
  const { app, page } = await launch({ openDir: dir });
  try {
    await expect(page.getByTestId('servers')).toHaveCount(0);
    await page.locator('.term-host.active').click();
    await page.keyboard.type(`cd alpha && node server.cjs\n`);
    const port = await expect
      .poll(() => readFile(join(repo, 'port.txt'), 'utf8').catch(() => ''), { timeout: 10_000 })
      .not.toBe('')
      .then(() => readFile(join(repo, 'port.txt'), 'utf8'));

    const counter = page.getByTestId('servers');
    await expect(counter).toHaveText(/1 server/, { timeout: 10_000 });
    await expect(page.getByTestId('tab-port')).toHaveText(port);
    await counter.click();
    const item = page.getByRole('menuitem');
    await expect(item).toHaveText(`localhost:${port}alpha · node server.cjs`);
    // Clicking the row opens the real browser; the test does not click it.
    await page.keyboard.press('Escape');

    await page.locator('.term-host.active').click();
    await page.keyboard.press('Control+c');
    await expect(counter).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('tab-port')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
