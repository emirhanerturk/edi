import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type ElectronApplication, type Page, _electron } from '@playwright/test';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Testler yalnız geçici klasörlerde çalışır; kullanıcının repolarına dokunmaz. */
export async function tmpDir(prefix = 'edi-e2e-'): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** Kullanıcının global git ayarlarından (hook, imzalama) bağımsız git. */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, env: GIT_ENV });
  return stdout;
}

/** `main` dalında, bir commit'i olan repo. */
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

/** Yerel bir bare repo oluşturur ve `origin` olarak ekler; yolunu döner. Hiçbir şey push edilmez. */
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

/** Uygulamayı boş bir kullanıcı verisi klasörüyle (ya da verilenle) ve görünmez pencereyle açar. */
export async function launch(opts: { openDir?: string; userData?: string; usageFile?: string } = {}): Promise<Launched> {
  const userData = opts.userData ?? (await tmpDir('edi-e2e-data-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(GIT_ENV)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env.EDI_USER_DATA = userData;
  env.EDI_HIDDEN = '1';
  // Kullanıcının kabuk profili testleri yavaşlatmasın ve değiştirmesin.
  env.EDI_SHELL = '/bin/sh';
  // Kullanıcının gerçek Claude kullanım dosyası okunmaz.
  env.EDI_USAGE_FILE = opts.usageFile ?? join(userData, 'claude-usage.json');
  if (opts.openDir) env.EDI_OPEN_DIR = opts.openDir;

  const app = await _electron.launch({ args: [root], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Görünmez pencerede soru kutusu yanıtlanamaz: testlerde varsayılan yanıt ilk düğmedir (onay).
  await answerDialogs(app, 0);
  return { app, page, userData };
}

type Asked = { message: string; detail: string; buttons: string[] };

/**
 * Bundan sonra uygulamanın soracağı "çalışan süreç var" sorularını verilen düğmeyle yanıtlar ve
 * kaydeder. Sayfanın `window.confirm` kutuları da Electron'da aynı işlevden geçer; onlara
 * dokunulmaz (Playwright'ın `dialog` olayıyla yanıtlanırlar).
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

/** Şimdiye kadar sorulan soru kutuları. */
export function askedDialogs(app: ElectronApplication): Promise<Asked[]> {
  return app.evaluate(() => (globalThis as unknown as { __ediDialogs?: Asked[] }).__ediDialogs ?? []);
}
