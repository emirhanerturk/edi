import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * Dock'tan açılan uygulama kullanıcının kabuk ayarlarını (PATH: nvm'deki node, Homebrew) almaz;
 * git hook'ları "node bulunamadı" diye düşer. Paketli uygulama açılırken giriş kabuğunun
 * ortamı bir kez okunur ve ana sürecin ortamına eklenir.
 */

/** İki işaret arasındaki `env -0` çıktısı; kabuğun önüne ve arkasına bastığı gürültü atlanır. */
export function parseEnvBlock(out: string, marker: string): Record<string, string> | null {
  const start = out.indexOf(marker);
  const end = start === -1 ? -1 : out.indexOf(marker, start + marker.length);
  if (end === -1) return null;
  const env: Record<string, string> = {};
  for (const entry of out.slice(start + marker.length, end).split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/** Giriş kabuğunun (`-il`) ortamı. Kabuk hata verirse ya da `timeoutMs` içinde bitmezse null. */
export function readLoginEnv(shell: string, opts: { timeoutMs?: number } = {}): Promise<Record<string, string> | null> {
  const { timeoutMs = 10_000 } = opts;
  const marker = `__EDI_ENV_${randomBytes(6).toString('hex')}__`;
  const command = `printf '%s' '${marker}'; /usr/bin/env -0; printf '%s' '${marker}'`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: Record<string, string> | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    // Kendi süreç grubunda: zaman aşımında kabuğun başlattığı her şey birlikte kapanır.
    const child = spawn(shell, ['-ilc', command], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Zaten bitti.
      }
      finish(null);
    }, timeoutMs);
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? parseEnvBlock(Buffer.concat(chunks).toString('utf8'), marker) : null));
  });
}

/** Kabuğa ya da uygulamaya özgü, taşınmayan değişkenler. */
const SKIPPED = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);
const skipped = (name: string) => SKIPPED.has(name) || name.startsWith('ELECTRON_') || name.startsWith('EDI_');

/** Giriş kabuğunun değerleri eklenir ya da üstüne yazılır; uygulamanın kendi ayarları korunur. */
export function mergeLoginEnv(base: NodeJS.ProcessEnv, login: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const [name, value] of Object.entries(login)) {
    if (!skipped(name)) env[name] = value;
  }
  return env;
}
