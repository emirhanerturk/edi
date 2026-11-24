// `npm run dist`: imzasız (ad-hoc) edi.app üretir ve kurar: /Applications/edi.app ve
// ~/.local/bin/edi. `--no-install` yalnız üretir (release/ altında).
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { BUNDLE_ID, install, preflight } from './install.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const noInstall = process.argv.includes('--no-install');
const target = { appPath: '/Applications/edi.app', linkPath: join(homedir(), '.local', 'bin', 'edi') };

/** Kurulum hatası: yığın dökümü yerine tek satır. */
function fail(error) {
  console.error(`npm run dist: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// Kurulamayacaksa (edi açık, yerinde başka bir edi) paketlemeden önce söylenir.
if (!noInstall) await preflight(target).catch(fail);

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

const [out] = await packager({
  dir: root,
  name: 'edi',
  executableName: 'edi',
  appBundleId: BUNDLE_ID,
  appCategoryType: 'public.app-category.developer-tools',
  icon: join(root, 'build', 'icon.icns'),
  out: join(root, 'release'),
  overwrite: true,
  platform: 'darwin',
  arch: process.arch,
  // node-pty'nin yerel modülü ve spawn-helper'ı asar arşivinin dışında olmalı.
  asar: { unpack: '**/node_modules/node-pty/**' },
  extraResource: [join(root, 'resources', 'edi'), join(root, 'resources', 'edi-statusline')],
  // Yalnız derlenmiş kod, package.json ve (packager'ın ayıkladığı) çalışma bağımlılıkları.
  // node_modules içindeki araç önbellekleri (.vite, .vitest-cache, .bin) da alınmaz.
  ignore: (path) =>
    !(path === '' || path === '/package.json' || /^\/(dist|node_modules)(\/|$)/.test(path)) || /^\/node_modules\/\./.test(path),
  prune: true,
});
const built = join(out, 'edi.app');
// Apple Silicon imzasız uygulamayı açmaz; geliştirici sertifikası olmadan ad-hoc imza.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', built], { stdio: 'inherit' });
console.log(`Built ${built}`);

if (!noInstall) {
  const lines = await install({ built, ...target }).catch(fail);
  for (const line of lines) console.log(line);
  console.log('Open a folder with: edi <folder>');
}
