import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addRemote, git, launch, makeRepo, tmpDir } from './helpers.js';

test('a changed file shows in the Git tab within a few seconds', async () => {
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

    await writeFile(join(alpha, 'README.md'), 'changed\n');
    await writeFile(join(alpha, 'new.txt'), 'x\n');
    await expect(page.getByTestId('file-row')).toHaveCount(2, { timeout: 10_000 });
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('git-badge')).toHaveText('2');
    // A collapsed row has one sync button: there is a remote, but the branch is not published yet.
    await expect(rows.nth(1).getByTestId('sync-button')).toHaveText('Publish branch');
    // A repo without a remote has nowhere to publish: no button either.
    await expect(rows.nth(2).getByTestId('sync-button')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('staging and committing brings the repo back to clean', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await writeFile(join(alpha, 'README.md'), 'changed\n');
  await writeFile(join(alpha, 'new.txt'), 'x\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    const row = page.getByTestId('repo-row');
    await expect(page.getByTestId('file-row')).toHaveCount(2);
    await expect(page.getByTestId('commit-button')).toHaveText('Commit all · 2 files');

    // Only README is staged: the button becomes "Commit · 1 file".
    await page.locator('[data-testid="file-row"][data-path="README.md"]').getByTestId('stage-file').click();
    await expect(page.getByTestId('commit-button')).toHaveText('Commit · 1 file');
    await expect(page.getByTestId('commit-button')).toBeDisabled();

    await page.getByTestId('commit-message').fill('docs: update the readme\n\nSecond paragraph.');
    await page.getByTestId('commit-button').click();
    await expect(page.getByTestId('file-row')).toHaveCount(1);
    await expect(page.getByTestId('commit-message')).toHaveValue('');
    expect(await git(alpha, 'log', '-1', '--format=%B')).toBe('docs: update the readme\n\nSecond paragraph.\n\n');
    expect(await git(alpha, 'status', '--porcelain')).toBe('?? new.txt\n');

    // Cmd+Enter commits the remaining file as "Commit all"; the repo turns clean and stays open.
    await page.getByTestId('commit-message').fill('feat: add the new file');
    await page.getByTestId('commit-message').press('Meta+Enter');
    await expect(page.getByTestId('file-row')).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('repo-toggle').click();
    await expect(row.getByLabel('Clean')).toBeVisible();
    expect(await git(alpha, 'log', '-1', '--format=%s')).toBe('feat: add the new file\n');
  } finally {
    await app.close();
  }
});

test('Commit and push sends to the local remote; the button on the collapsed row pushes', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  const bare = await addRemote(alpha);
  await writeFile(join(alpha, 'new.txt'), 'x\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByTestId('commit-message').fill('feat: first');
    await page.getByLabel('Commit options').click();
    await page.getByRole('menuitem', { name: 'Commit and push' }).click();
    await expect.poll(() => git(bare, 'log', '-1', '--format=%s', 'main').catch(() => '')).toBe('feat: first\n');
    // The repo stays open after the commit; closed by hand, its row has the sync button.
    await expect(page.getByTestId('repo-row')).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('repo-toggle').click();
    await expect(page.getByTestId('repo-row')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('sync-button')).toHaveCount(0);

    // A new commit, as if made from the terminal: the row shows "Push 1", and pressing it pushes.
    await writeFile(join(alpha, 'second.txt'), 'x\n');
    await git(alpha, 'add', '-A');
    await git(alpha, 'commit', '-q', '-m', 'feat: second');
    await expect(page.getByTestId('sync-button')).toHaveText('Push 1', { timeout: 10_000 });
    await page.getByTestId('sync-button').click();
    // While the push runs, the button gives way to "Pushing…"; when it finishes the row shows clean.
    await expect.poll(() => git(bare, 'log', '-1', '--format=%s', 'main')).toBe('feat: second\n');
    await expect(page.getByTestId('repo-row').getByLabel('Clean')).toBeVisible();
    await expect(page.getByTestId('sync-button')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a git error shows under the repo and can be dismissed; a new branch is created', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await writeFile(join(alpha, 'README.md'), 'changed\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    // Git refuses to create a branch with an existing name.
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
    expect(await git(alpha, 'status', '--porcelain')).toBe(' M README.md\n'); // the change is kept

    // Switch back to the old branch from the menu.
    await page.getByTestId('branch-button').click();
    await page.getByRole('menuitem', { name: 'main' }).click();
    await expect(page.getByTestId('branch-button')).toContainText('main');
  } finally {
    await app.close();
  }
});

test('the branch menu is not clipped at the panel edge; New branch stays visible with many branches', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  for (let i = 0; i < 30; i++) await git(alpha, 'branch', `claude/a-rather-long-branch-name-for-clipping-${String(i).padStart(2, '0')}`);
  await writeFile(join(alpha, 'README.md'), 'changed\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByTestId('branch-button').click();
    const menu = page.locator('.branch-menu');
    await expect(menu.getByRole('menuitem', { name: 'main' })).toBeVisible();

    // Just inside each of the menu's four corners, the topmost element must be the menu itself (not clipped).
    const corners = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const points = [
        [r.left + 3, r.top + 3],
        [r.right - 3, r.top + 3],
        [r.left + 3, r.bottom - 3],
        [r.right - 3, r.bottom - 3],
      ] as const;
      return {
        inside: points.map(([x, y]) => el.contains(document.elementFromPoint(x, y))),
        inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      };
    });
    expect(corners).toEqual({ inside: [true, true, true, true], inViewport: true });

    // A long name fits without truncation.
    const first = menu.getByRole('menuitem', { name: 'claude/a-rather-long-branch-name-for-clipping-00' }).locator('.menu-item-text');
    expect(await first.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    // "New branch…" stays fixed at the bottom even when the list scrolls.
    await expect(menu.getByRole('menuitem', { name: 'New branch…' })).toBeInViewport();
    await menu.getByRole('menuitem', { name: 'claude/a-rather-long-branch-name-for-clipping-29' }).scrollIntoViewIfNeeded();
    await expect(menu.getByRole('menuitem', { name: 'New branch…' })).toBeInViewport();
  } finally {
    await app.close();
  }
});

test('unpushed commits are listed under the repo; one opens in the commit view, the newest can be undone', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await addRemote(alpha);
  await git(alpha, 'push', '-q', '-u', 'origin', 'main');
  for (const name of ['one', 'two']) {
    await writeFile(join(alpha, `${name}.txt`), `${name}\n`);
    await git(alpha, 'add', '-A');
    await git(alpha, 'commit', '-q', '-m', `feat: ${name}`);
  }
  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByTestId('repo-toggle').click();
    const rows = page.getByTestId('unpushed-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('feat: two');
    await expect(page.getByTestId('undo-commit')).toHaveCount(1);

    await rows.nth(1).click();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'commit');
    await expect(page.locator('.commit-title')).toContainText('feat: one');

    // Cancel at the question: nothing happens.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await page.getByTestId('undo-commit').click();
    await page.waitForTimeout(300);
    expect((await git(alpha, 'log', '-1', '--format=%s')).trim()).toBe('feat: two');

    // Confirm: the commit is gone, its file is staged again.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await page.getByTestId('undo-commit').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('feat: one');
    expect((await git(alpha, 'log', '-1', '--format=%s')).trim()).toBe('feat: one');
    await expect(page.locator('[data-testid="file-row"][data-group="staged"][data-path="two.txt"]')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a change is discarded from its row; Discard all resets the rest and trashes new files', async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  await writeFile(join(alpha, 'b.txt'), 'b\n');
  await git(alpha, 'add', '-A');
  await git(alpha, 'commit', '-q', '-m', 'feat: b');
  await writeFile(join(alpha, 'README.md'), 'edited\n');
  await writeFile(join(alpha, 'b.txt'), 'b edited\n');
  await writeFile(join(alpha, 'new.txt'), 'new\n');
  const { app, page } = await launch({ openDir: dir });
  try {
    // Every question is answered "Discard"; the Trash records the path and removes the file.
    await app.evaluate(({ dialog, shell }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      const trashed: string[] = [];
      (globalThis as { trashed?: string[] }).trashed = trashed;
      shell.trashItem = async (path: string) => {
        trashed.push(path);
        process.getBuiltinModule('node:fs').rmSync(path);
      };
    });
    const changes = page.locator('[data-testid="file-row"][data-group="changes"]');
    await expect(changes).toHaveCount(3);

    // A row's buttons show only while the pointer is over it, lined up under the header's.
    const firstActions = changes.first().locator('.file-actions');
    await page.mouse.move(0, 0);
    await expect(firstActions).toHaveCSS('opacity', '0');
    await changes.first().hover();
    await expect(firstActions).toHaveCSS('opacity', '1');
    const left = async (testId: string, scope = page.locator('body')) => (await scope.getByTestId(testId).first().boundingBox())!.x;
    expect(await left('discard-file', changes.first())).toBe(await left('discard-all'));
    expect(await left('stage-file', changes.first())).toBe(await left('stage-all'));

    await changes.filter({ hasText: 'README.md' }).getByTestId('discard-file').click();
    await expect(changes).toHaveCount(2);
    expect(await readFile(join(alpha, 'README.md'), 'utf8')).toBe('readme\n');

    await page.getByTestId('discard-all').click();
    await expect(changes).toHaveCount(0);
    expect(await readFile(join(alpha, 'b.txt'), 'utf8')).toBe('b\n');
    expect(await app.evaluate(() => (globalThis as { trashed?: string[] }).trashed)).toEqual([join(alpha, 'new.txt')]);
  } finally {
    await app.close();
  }
});
