// `npm run dist`'in kurulum adımı: edi.app'i /Applications'a kopyalar, `edi` komutunu
// ~/.local/bin'e bağlar. edi'ye ait olmayan bir uygulamanın ya da komutun üzerine yazmaz;
// edi açıkken kurmaz. Her denetim, hiçbir şey değişmeden önce yapılır.
import { execFile } from 'node:child_process';
import { lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const BUNDLE_ID = 'dev.edi.app';

/** Kurulu uygulamanın içindeki komut betiği. */
export const commandIn = (appPath) => join(appPath, 'Contents', 'Resources', 'edi');

const exists = (path) => lstat(path).then(() => true, () => false);

/** `appPath`'te uygulama yok mu, edi mi, başka bir şey mi. */
export async function checkTarget(appPath) {
  if (!(await exists(appPath))) return 'missing';
  try {
    const { stdout } = await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')]);
    return stdout.trim() === BUNDLE_ID ? 'ours' : 'foreign';
  } catch {
    return 'foreign';
  }
}

/** `linkPath` yok mu, `target`'a giden bağımız mı, başka bir şey mi. */
export async function checkLink(linkPath, target) {
  const info = await lstat(linkPath).catch(() => null);
  if (!info) return 'missing';
  if (!info.isSymbolicLink()) return 'foreign';
  return (await readlink(linkPath)) === target ? 'ours' : 'foreign';
}

/** Kurulu edi çalışıyor mu. */
export async function isRunning(appPath) {
  try {
    await run('pgrep', ['-f', `${appPath}/Contents/MacOS/`]);
    return true;
  } catch {
    return false; // pgrep eşleşme yoksa 1 ile çıkar.
  }
}

/** Kurulumun denetimleri; bir şey tutmazsa hata verir. Hiçbir şeye dokunmaz. */
export async function preflight({ appPath, linkPath, isRunning: running = isRunning }) {
  if (await running(appPath)) throw new Error('Quit edi before installing');
  const target = await checkTarget(appPath);
  if (target === 'foreign') throw new Error(`${appPath} is not edi; leaving it alone`);
  const link = await checkLink(linkPath, commandIn(appPath));
  if (link === 'foreign') throw new Error(`${linkPath} is not edi's command; leaving it alone`);
  return undefined;
}

/** Kurar; yapılanları satır satır döner. Bir denetim tutmazsa hiçbir şeye dokunmadan hata verir. */
export async function install({ built, appPath, linkPath, isRunning: running = isRunning }) {
  // Paketleme sürerken durum değişmiş olabilir: denetimler kurmadan hemen önce yeniden yapılır.
  await preflight({ appPath, linkPath, isRunning: running });
  const target = await checkTarget(appPath);
  const command = commandIn(appPath);
  const link = await checkLink(linkPath, command);

  const lines = [];
  if (target === 'ours') await rm(appPath, { recursive: true, force: true });
  await run('ditto', [built, appPath]);
  lines.push(`${target === 'ours' ? 'Updated' : 'Installed'} ${appPath}`);
  if (link === 'missing') {
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(command, linkPath);
    lines.push(`Linked ${linkPath} -> ${command}`);
  } else {
    lines.push(`${linkPath} already points to edi`);
  }
  return lines;
}
