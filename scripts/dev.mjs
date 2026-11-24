// Geliştirme: ana süreci derler, sayfayı Vite'tan (anında yenilemeyle) sunar ve Electron'u açar.
// Ana süreçteki değişiklikler için yeniden başlatmak gerekir.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const tsc = spawnSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.main.json'], { stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const server = await createServer({ configFile: join(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local[0];

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(/** @type {string} */ (/** @type {unknown} */ (electron)), ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
