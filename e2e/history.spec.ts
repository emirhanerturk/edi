import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Page, expect, test } from '@playwright/test';
import { addRemote, git, launch, makeRepo, nextMenuPicks, tmpDir } from './helpers.js';

const run = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

/** Commits the given number of hours ago (author and committer date). */
async function commitAgo(repo: string, subject: string, hours: number, file = 'a.txt'): Promise<void> {
  await writeFile(join(repo, file), `${subject}\n`);
  await git(repo, 'add', '-A');
  const date = `@${Math.floor(Date.now() / 1000 - hours * 3600)} +0000`;
  await run('git', ['commit', '-q', '-m', subject], { cwd: repo, env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

/** Moves makeRepo's 'chore: init' commit back by the given number of hours. */
async function backdateInit(repo: string, hours: number): Promise<void> {
  const date = `@${Math.floor(Date.now() / 1000 - hours * 3600)} +0000`;
  await run('git', ['commit', '-q', '--amend', '--no-edit', `--date=${date}`], { cwd: repo, env: { ...GIT_ENV, GIT_COMMITTER_DATE: date } });
}

const subjects = (page: Page) => page.getByTestId('history-commit').locator('.history-subject');

test('the History tab shows the commits of every repo', async () => {
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
    // makeRepo's 'chore: init' commits are the oldest.
    await expect(subjects(page)).toHaveText([
      'fix(alpha): local change',
      'feat(beta): middle',
      'feat(alpha): pushed work',
      'chore: init',
      'chore: init',
    ]);
    // The newest commit is an hour old: just after midnight that is yesterday.
    const newest = new Date(Date.now() - 3600_000);
    await expect(page.getByText(newest.toDateString() === new Date().toDateString() ? 'TODAY' : 'YESTERDAY')).toBeVisible();
    const local = page.getByTestId('history-commit').filter({ hasText: 'local change' });
    await expect(local.getByRole('img', { name: 'Not pushed yet' })).toBeVisible();
    await expect(page.getByTestId('history-commit').filter({ hasText: 'pushed work' }).getByRole('img', { name: 'Not pushed yet' })).toHaveCount(0);
    await expect(local).toContainText('alpha');

    // The commit view.
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

    // A changed file opens from its header; the commit tab stays.
    await view.getByRole('button', { name: 'Open a.txt' }).click();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'file');
    await expect(page.getByTestId('center-tab')).toHaveCount(2);
    await page.getByTestId('center-tab').first().click();
    await expect(page.getByTestId('center-view')).toHaveAttribute('data-kind', 'commit');

    // Filter to one repo: the repo name is hidden, the upstream line and the branch show.
    await page.getByRole('button', { name: 'All repositories' }).click();
    await page.getByRole('menuitemradio', { name: 'alpha' }).click();
    await expect(subjects(page)).toHaveText(['fix(alpha): local change', 'feat(alpha): pushed work', 'chore: init']);
    await expect(page.getByTestId('history-remote')).toHaveText('origin/main');
    await expect(page.getByTestId('history-branch')).toHaveText('main');

    // A commit made from the terminal shows on the next poll.
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

test('a long commit body shows its first lines until clicked', async () => {
  const dir = await tmpDir();
  const repo = await makeRepo(dir, 'alpha');
  await writeFile(join(repo, 'a.txt'), 'a\n');
  await git(repo, 'add', '-A');
  const long = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1} explains one more part of the change.`).join('\n\n');
  await git(repo, 'commit', '-q', '-m', 'feat: long story', '-m', long);
  await git(repo, 'commit', '-q', '--allow-empty', '-m', 'fix: short story', '-m', 'One line is enough.');

  const { app, page } = await launch({ openDir: dir });
  try {
    await page.getByRole('tab', { name: /History/ }).click();
    const message = page.getByTestId('commit-text');
    await page.getByTestId('history-commit').filter({ hasText: 'short story' }).click();
    await expect(message).toHaveAttribute('data-folded', 'false');
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);

    await page.getByTestId('history-commit').filter({ hasText: 'long story' }).click();
    await expect(message).toHaveAttribute('data-folded', 'true');
    // Three lines show: about 58px of the six paragraphs' 166 or so.
    const folded = (await message.boundingBox())!.height;
    expect(folded).toBeLessThan(65);
    await message.click();
    await expect(message).toHaveAttribute('data-folded', 'false');
    expect((await message.boundingBox())!.height).toBeGreaterThan(folded * 2);
    await page.getByRole('button', { name: 'Show less' }).click();
    await expect(message).toHaveAttribute('data-folded', 'true');
  } finally {
    await app.close();
  }
});

test("a commit is reverted from History's menu and from the commit view's ⋯; a conflicting one is aborted", async () => {
  const dir = await tmpDir();
  const alpha = await makeRepo(dir, 'alpha');
  const commit = async (file: string, text: string, message: string) => {
    await writeFile(join(alpha, file), text);
    await git(alpha, 'add', '-A');
    await git(alpha, 'commit', '-q', '-m', message);
  };
  await commit('f.txt', 'a\n', 'feat: one');
  await commit('f.txt', 'b\n', 'feat: two');
  await commit('g.txt', 'x\n', 'feat: three');
  const last = async () => (await git(alpha, 'log', '-1', '--format=%s')).trim();
  const { app, page } = await launch({ openDir: dir });
  try {
    // Every question is answered with its first button: Revert commit.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await page.getByRole('tab', { name: /History/ }).click();
    const rows = page.getByTestId('history-commit');
    await expect(rows.first()).toContainText('feat: three');

    await nextMenuPicks(app, 'Revert Commit…');
    await rows.filter({ hasText: 'feat: three' }).click({ button: 'right' });
    await expect(rows.first()).toContainText('Revert "feat: three"');
    expect(await last()).toBe('Revert "feat: three"');
    await expect(page.getByRole('tab', { name: /History/ })).toHaveAttribute('aria-selected', 'true');

    // feat: one's line was changed again by feat: two: reverting it conflicts and is aborted.
    await rows.filter({ hasText: 'feat: one' }).click();
    await expect(page.locator('.commit-title')).toContainText('feat: one');
    await nextMenuPicks(app, 'Revert Commit…');
    await page.getByTestId('commit-more').click();
    await expect(page.getByTestId('error-box')).toContainText("can't be reverted cleanly");
    await expect(page.getByRole('tab', { name: /^Git/ })).toHaveAttribute('aria-selected', 'true');
    expect(await last()).toBe('Revert "feat: three"');
    expect(await readFile(join(alpha, 'f.txt'), 'utf8')).toBe('b\n');
    expect(await stat(join(alpha, '.git', 'REVERT_HEAD')).then(() => true, () => false)).toBe(false);
  } finally {
    await app.close();
  }
});
