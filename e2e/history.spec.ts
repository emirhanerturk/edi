import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Page, expect, test } from '@playwright/test';
import { addRemote, git, launch, makeRepo, tmpDir } from './helpers.js';

const run = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

/** Verilen saat önce commit atar (yazar ve commit tarihi). */
async function commitAgo(repo: string, subject: string, hours: number, file = 'a.txt'): Promise<void> {
  await writeFile(join(repo, file), `${subject}\n`);
  await git(repo, 'add', '-A');
  const date = `@${Math.floor(Date.now() / 1000 - hours * 3600)} +0000`;
  await run('git', ['commit', '-q', '-m', subject], { cwd: repo, env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

/** makeRepo'nun 'chore: init' commitini verilen saat öncesine taşır. */
async function backdateInit(repo: string, hours: number): Promise<void> {
  const date = `@${Math.floor(Date.now() / 1000 - hours * 3600)} +0000`;
  await run('git', ['commit', '-q', '--amend', '--no-edit', `--date=${date}`], { cwd: repo, env: { ...GIT_ENV, GIT_COMMITTER_DATE: date } });
}

const subjects = (page: Page) => page.getByTestId('history-commit').locator('.history-subject');

test("History sekmesi tüm repoların commit'lerini gösterir", async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  const beta = await makeRepo(dir, 'beta');
  await backdateInit(alpha, 5);
  await backdateInit(beta, 6);
  await addRemote(alpha);
  await commitAgo(alpha, 'feat(alpha): pushed work', 3);
  await git(alpha, 'push', '-q', '-u', 'origin', 'main');
  await commitAgo(alpha, 'fix(alpha): local change', 1, 'b.txt');
  await commitAgo(beta, 'feat(beta): middle', 2);

  const first = await launch({ openDir: dir });
  try {
    const { page } = first;
    await page.getByRole('tab', { name: /History/ }).click();
    // makeRepo'nun 'chore: init' commitleri en eskiler.
    await expect(subjects(page)).toHaveText([
      'fix(alpha): local change',
      'feat(beta): middle',
      'feat(alpha): pushed work',
      'chore: init',
      'chore: init',
    ]);
    await expect(page.getByText('TODAY')).toBeVisible();
    const local = page.getByTestId('history-commit').filter({ hasText: 'local change' });
    await expect(local.getByRole('img', { name: 'Not pushed yet' })).toBeVisible();
    await expect(page.getByTestId('history-commit').filter({ hasText: 'pushed work' }).getByRole('img', { name: 'Not pushed yet' })).toHaveCount(0);
    await expect(local).toContainText('alpha');

    // Commit görünümü.
    await page.getByTestId('history-commit').filter({ hasText: 'middle' }).click();
    const view = page.getByTestId('center-view');
    await expect(view).toHaveAttribute('data-kind', 'commit');
    await expect(view.getByRole('heading', { level: 1 })).toHaveText('feat(beta): middle');
    await expect(view.getByTestId('commit-meta')).toContainText('beta');
    await expect(view.getByTestId('commit-meta')).toContainText('+1');
    await expect(view.getByTestId('commit-file')).toHaveCount(1);
    await expect(view.getByTestId('commit-file')).toContainText('a.txt');
    await expect(view.locator('[data-testid="diff-row"][data-kind="add"]')).toContainText('feat(beta): middle');
    await expect(page.getByTestId('center-info')).toHaveText('1 file changed');
    await expect(page.getByTestId('history-commit').filter({ hasText: 'middle' })).toHaveAttribute('aria-current', 'true');

    // Tek repoya süz: repo adı gizlenir, upstream çizgisi ve branch görünür.
    await page.getByRole('button', { name: 'All repositories' }).click();
    await page.getByRole('menuitemradio', { name: 'alpha' }).click();
    await expect(subjects(page)).toHaveText(['fix(alpha): local change', 'feat(alpha): pushed work', 'chore: init']);
    await expect(page.getByTestId('history-remote')).toHaveText('origin/main');
    await expect(page.getByTestId('history-branch')).toHaveText('main');

    // Terminal tarafında atılan commit bir sonraki yoklamada görünür.
    await commitAgo(alpha, 'feat(alpha): from the terminal', 0, 'c.txt');
    await expect(subjects(page).first()).toHaveText('feat(alpha): from the terminal');

    await page.getByRole('button', { name: 'By repo' }).click();
    await expect(page.getByTestId('history-group')).toHaveCount(1);
  } finally {
    await first.app.close();
  }

  const second = await launch({ openDir: dir, userData: first.userData });
  try {
    const { page } = second;
    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page.getByRole('button', { name: 'By repo' })).toHaveAttribute('aria-pressed', 'true');
    const groups = page.getByTestId('history-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.first()).toContainText('alpha');
    await expect(groups.first()).toContainText('↑2');
    await expect(page.getByTestId('history-line').first()).toContainText('from the terminal');
  } finally {
    await second.app.close();
  }
});
