import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BUNDLE_ID, checkLink, checkTarget, install, preflight } from '../scripts/install.mjs';
import { makeTmpDir } from './helpers/tmpRepo.js';

const run = promisify(execFile);

/** A fake .app with the given bundle id and a marker file inside. */
async function fakeApp(path: string, id: string, marker: string): Promise<string> {
  await mkdir(join(path, 'Contents', 'Resources'), { recursive: true });
  await run('plutil', ['-create', 'xml1', join(path, 'Contents', 'Info.plist')]);
  await run('plutil', ['-insert', 'CFBundleIdentifier', '-string', id, join(path, 'Contents', 'Info.plist')]);
  await writeFile(join(path, 'Contents', 'Resources', 'marker'), marker);
  await writeFile(join(path, 'Contents', 'Resources', 'edi'), '#!/bin/sh\n');
  return path;
}

const exists = (path: string) => lstat(path).then(() => true, () => false);
const notRunning = async () => false;

describe('checkTarget / checkLink', () => {
  it("reports missing, ours or foreign", async () => {
    const dir = await makeTmpDir();
    expect(await checkTarget(join(dir, 'missing.app'))).toBe('missing');
    expect(await checkTarget(await fakeApp(join(dir, 'a.app'), BUNDLE_ID, '1'))).toBe('ours');
    expect(await checkTarget(await fakeApp(join(dir, 'b.app'), 'com.other.edi', '1'))).toBe('foreign');
    await mkdir(join(dir, 'empty.app'));
    expect(await checkTarget(join(dir, 'empty.app'))).toBe('foreign');

    const target = join(dir, 'a.app', 'Contents', 'Resources', 'edi');
    expect(await checkLink(join(dir, 'link'), target)).toBe('missing');
    await symlink(target, join(dir, 'link'));
    expect(await checkLink(join(dir, 'link'), target)).toBe('ours');
    await symlink('/elsewhere', join(dir, 'link2'));
    expect(await checkLink(join(dir, 'link2'), target)).toBe('foreign');
    await writeFile(join(dir, 'file'), 'x');
    expect(await checkLink(join(dir, 'file'), target)).toBe('foreign');
  });
});

describe('preflight', () => {
  it('runs the same checks before packaging and touches nothing', async () => {
    const dir = await makeTmpDir();
    const appPath = join(dir, 'Applications', 'edi.app');
    const linkPath = join(dir, 'bin', 'edi');
    await expect(preflight({ appPath, linkPath, isRunning: notRunning })).resolves.toBeUndefined();
    await expect(preflight({ appPath, linkPath, isRunning: async () => true })).rejects.toThrow('Quit edi before installing');
    await fakeApp(appPath, 'com.other.edi', 'other');
    await expect(preflight({ appPath, linkPath, isRunning: notRunning })).rejects.toThrow(`${appPath} is not edi; leaving it alone`);
    expect(await exists(linkPath)).toBe(false);
  });
});

describe('install', () => {
  it('copies the app and links the command on first install, and updates on the second', async () => {
    const dir = await makeTmpDir();
    const appPath = join(dir, 'Applications', 'edi.app');
    const linkPath = join(dir, 'bin', 'edi');
    await mkdir(join(dir, 'Applications'));
    const v1 = await fakeApp(join(dir, 'v1', 'edi.app'), BUNDLE_ID, 'v1');
    await install({ built: v1, appPath, linkPath, isRunning: notRunning });
    expect(await readFile(join(appPath, 'Contents', 'Resources', 'marker'), 'utf8')).toBe('v1');
    expect(await readlink(linkPath)).toBe(join(appPath, 'Contents', 'Resources', 'edi'));

    const v2 = await fakeApp(join(dir, 'v2', 'edi.app'), BUNDLE_ID, 'v2');
    await writeFile(join(appPath, 'Contents', 'Resources', 'old'), 'x');
    const lines = await install({ built: v2, appPath, linkPath, isRunning: notRunning });
    expect(await readFile(join(appPath, 'Contents', 'Resources', 'marker'), 'utf8')).toBe('v2');
    expect(await exists(join(appPath, 'Contents', 'Resources', 'old'))).toBe(false);
    expect(lines).toEqual([`Updated ${appPath}`, `${linkPath} already points to edi`]);
  });

  it('touches nothing when a foreign app or command is in the way', async () => {
    const dir = await makeTmpDir();
    const built = await fakeApp(join(dir, 'new', 'edi.app'), BUNDLE_ID, 'new');
    const foreignApp = await fakeApp(join(dir, 'Applications', 'edi.app'), 'com.other.edi', 'other');
    await expect(install({ built, appPath: foreignApp, linkPath: join(dir, 'bin', 'edi'), isRunning: notRunning })).rejects.toThrow(
      `${foreignApp} is not edi; leaving it alone`,
    );
    expect(await readFile(join(foreignApp, 'Contents', 'Resources', 'marker'), 'utf8')).toBe('other');
    expect(await exists(join(dir, 'bin', 'edi'))).toBe(false);

    const appPath = join(dir, 'Apps2', 'edi.app');
    await mkdir(join(dir, 'Apps2'));
    await mkdir(join(dir, 'bin2'));
    await writeFile(join(dir, 'bin2', 'edi'), 'other command');
    await expect(install({ built, appPath, linkPath: join(dir, 'bin2', 'edi'), isRunning: notRunning })).rejects.toThrow(
      `${join(dir, 'bin2', 'edi')} is not edi's command; leaving it alone`,
    );
    expect(await exists(appPath)).toBe(false);
    expect(await readFile(join(dir, 'bin2', 'edi'), 'utf8')).toBe('other command');
  });

  it('does not install while edi is running', async () => {
    const dir = await makeTmpDir();
    const built = await fakeApp(join(dir, 'new', 'edi.app'), BUNDLE_ID, 'new');
    const appPath = await fakeApp(join(dir, 'Applications', 'edi.app'), BUNDLE_ID, 'old');
    await expect(install({ built, appPath, linkPath: join(dir, 'bin', 'edi'), isRunning: async () => true })).rejects.toThrow(
      'Quit edi before installing',
    );
    expect(await readFile(join(appPath, 'Contents', 'Resources', 'marker'), 'utf8')).toBe('old');
  });
});
