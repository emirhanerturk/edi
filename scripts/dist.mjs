// `npm run dist`: builds an unsigned (ad-hoc signed) edi.app and installs it: /Applications/edi.app and
// ~/.local/bin/edi. `--no-install` only builds (under release/).
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { BUNDLE_ID, install, preflight } from './install.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const noInstall = process.argv.includes('--no-install');
const target = { appPath: '/Applications/edi.app', linkPath: join(homedir(), '.local', 'bin', 'edi') };

/** An install error: one line instead of a stack trace. */
function fail(error) {
  console.error(`npm run dist: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// If it cannot be installed (edi is open, something else is in edi's place), say so before packaging.
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
  // node-pty's native module and spawn-helper must stay outside the asar archive.
  asar: { unpack: '**/node_modules/node-pty/**' },
  extraResource: [join(root, 'resources', 'edi'), join(root, 'resources', 'edi-statusline')],
  // Only the compiled code, package.json and the runtime dependencies (pruned by packager).
  // Tool caches inside node_modules (.vite, .vitest-cache, .bin) are left out too.
  ignore: (path) =>
    !(path === '' || path === '/package.json' || /^\/(dist|node_modules)(\/|$)/.test(path)) || /^\/node_modules\/\./.test(path),
  prune: true,
});
const built = join(out, 'edi.app');
// Apple Silicon will not open an unsigned app; sign ad-hoc, without a developer certificate.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', built], { stdio: 'inherit' });
console.log(`Built ${built}`);

if (!noInstall) {
  const lines = await install({ built, ...target }).catch(fail);
  for (const line of lines) console.log(line);
  console.log('Open a folder with: edi <folder>');
}
