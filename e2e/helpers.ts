import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type ElectronApplication, type Page, _electron } from '@playwright/test';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Tests run only in temporary folders; they never touch the user's repositories. */
export async function tmpDir(prefix = 'edi-e2e-'): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** Git independent of the user's global git config (hooks, signing). */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, env: GIT_ENV });
  return stdout;
}

/** A repo on the `main` branch with one commit. */
export async function makeRepo(parent: string, name: string): Promise<string> {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  await git(path, 'init', '-q', '-b', 'main');
  await git(path, 'config', 'user.name', 'Test');
  await git(path, 'config', 'user.email', 'test@example.com');
  await writeFile(join(path, 'README.md'), 'readme\n');
  await git(path, 'add', '-A');
  await git(path, 'commit', '-q', '-m', 'chore: init');
  return path;
}

/** Creates a local bare repo and adds it as `origin`; returns its path. Nothing is pushed. */
export async function addRemote(repo: string): Promise<string> {
  const bare = join(await tmpDir('edi-e2e-origin-'), 'origin.git');
  await git(repo, 'init', '-q', '--bare', '-b', 'main', bare);
  await git(repo, 'remote', 'add', 'origin', bare);
  return bare;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

/** Launches the app with an empty user data folder (or the given one) and a hidden window. */
export async function launch(opts: { openDir?: string; userData?: string; usageFile?: string } = {}): Promise<Launched> {
  const userData = opts.userData ?? (await tmpDir('edi-e2e-data-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(GIT_ENV)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env.EDI_USER_DATA = userData;
  env.EDI_HIDDEN = '1';
  // Keep the user's shell profile from slowing down or altering the tests.
  env.EDI_SHELL = '/bin/sh';
  // The user's real Claude usage file is never read.
  env.EDI_USAGE_FILE = opts.usageFile ?? join(userData, 'claude-usage.json');
  if (opts.openDir) env.EDI_OPEN_DIR = opts.openDir;

  const app = await _electron.launch({ args: [root], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // A hidden window cannot answer a dialog: in tests the default answer is the first button (confirm).
  await answerDialogs(app, 0);
  return { app, page, userData };
}

type Asked = { message: string; detail: string; buttons: string[] };

/**
 * From now on, answers the app's "running process" dialogs with the given button and records
 * them. The page's `window.confirm` boxes go through the same function in Electron; they are
 * left alone (they are answered through Playwright's `dialog` event).
 */
export async function answerDialogs(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const store = globalThis as unknown as { __ediDialogs?: Asked[]; __ediRealDialog?: typeof dialog.showMessageBox };
    store.__ediDialogs ??= [];
    store.__ediRealDialog ??= dialog.showMessageBox.bind(dialog);
    const real = store.__ediRealDialog;
    const fake = async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as Partial<Asked>;
      if (!options.detail?.includes('running process')) return (real as (...a: unknown[]) => unknown)(...args);
      store.__ediDialogs?.push({ message: options.message ?? '', detail: options.detail, buttons: options.buttons ?? [] });
      return { response: answer, checkboxChecked: false };
    };
    dialog.showMessageBox = fake as unknown as typeof dialog.showMessageBox;
  }, response);
}

/** The dialogs asked so far. */
export function askedDialogs(app: ElectronApplication): Promise<Asked[]> {
  return app.evaluate(() => (globalThis as unknown as { __ediDialogs?: Asked[] }).__ediDialogs ?? []);
}
