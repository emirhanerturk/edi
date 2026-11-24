// npm does not run the dependencies' install scripts. This script does the two jobs they would do:
// it makes node-pty's helper program executable and downloads Electron itself.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const helper = join(root, 'node_modules', 'node-pty', 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
if (existsSync(helper)) {
  chmodSync(helper, 0o755);
  console.log('node-pty: spawn-helper is executable');
} else {
  console.error(`node-pty: no prebuilt binary for ${process.platform}-${process.arch}`);
  process.exitCode = 1;
}

const electron = join(root, 'node_modules', 'electron');
if (existsSync(join(electron, 'path.txt'))) {
  console.log('electron: already installed');
} else {
  const result = spawnSync(process.execPath, [join(electron, 'install.js')], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = 1;
  else console.log('electron: installed');
}
