// The install step of `npm run dist`: copies edi.app to /Applications and links the `edi` command
// into ~/.local/bin. It never overwrites an app or a command that is not edi's, and does not
// install while edi is open. Every check runs before anything changes.
import { execFile } from 'node:child_process';
import { lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const BUNDLE_ID = 'dev.edi.app';

/** The command script inside the installed app. */
export const commandIn = (appPath) => join(appPath, 'Contents', 'Resources', 'edi');

const exists = (path) => lstat(path).then(() => true, () => false);

/** Whether `appPath` holds no app, edi, or something else. */
export async function checkTarget(appPath) {
  if (!(await exists(appPath))) return 'missing';
  try {
    const { stdout } = await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')]);
    return stdout.trim() === BUNDLE_ID ? 'ours' : 'foreign';
  } catch {
    return 'foreign';
  }
}

/** Whether `linkPath` is missing, our link to `target`, or something else. */
export async function checkLink(linkPath, target) {
  const info = await lstat(linkPath).catch(() => null);
  if (!info) return 'missing';
  if (!info.isSymbolicLink()) return 'foreign';
  return (await readlink(linkPath)) === target ? 'ours' : 'foreign';
}

/** Whether the installed edi is running. */
export async function isRunning(appPath) {
  try {
    await run('pgrep', ['-f', `${appPath}/Contents/MacOS/`]);
    return true;
  } catch {
    return false; // pgrep exits with 1 when nothing matches.
  }
}

/** The install checks; throws if anything is off. Touches nothing. */
export async function preflight({ appPath, linkPath, isRunning: running = isRunning }) {
  if (await running(appPath)) throw new Error('Quit edi before installing');
  const target = await checkTarget(appPath);
  if (target === 'foreign') throw new Error(`${appPath} is not edi; leaving it alone`);
  const link = await checkLink(linkPath, commandIn(appPath));
  if (link === 'foreign') throw new Error(`${linkPath} is not edi's command; leaving it alone`);
  return undefined;
}

const ditto = (from, to) => run('ditto', [from, to]);

/** Hidden folders beside the app (same volume, so renames are atomic): the new copy and the old app. */
const besideApp = (appPath) => ({
  staging: join(dirname(appPath), `.${basename(appPath)}.installing`),
  previous: join(dirname(appPath), `.${basename(appPath)}.previous`),
});

/**
 * Puts the built app in place without a moment where a half-copied app sits there: it is copied
 * beside the installed one first, then swapped in by renaming. If the copy stops, the installed app
 * is untouched; what an interrupted install left beside it is cleared the next time.
 */
async function replaceApp(built, appPath, hadApp, copy) {
  const { staging, previous } = besideApp(appPath);
  await rm(staging, { recursive: true, force: true });
  await rm(previous, { recursive: true, force: true });
  try {
    await copy(built, staging);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (hadApp) await rename(appPath, previous);
  try {
    await rename(staging, appPath);
  } catch (error) {
    if (hadApp) await rename(previous, appPath);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

/** Installs; returns what was done, one line per step. If a check fails, throws without touching anything. */
export async function install({ built, appPath, linkPath, isRunning: running = isRunning, copy = ditto }) {
  // Things may have changed while packaging: the checks run again right before installing.
  await preflight({ appPath, linkPath, isRunning: running });
  const target = await checkTarget(appPath);
  const command = commandIn(appPath);
  const link = await checkLink(linkPath, command);

  const lines = [];
  await replaceApp(built, appPath, target === 'ours', copy);
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
