import { spawn } from 'node:child_process';

export type GitResult = { ok: true; stdout: string } | { ok: false; error: string; stdout: string };

export interface RunGitOptions {
  /** Varsayılan 15000. Aşılırsa süreç grubu öldürülür. */
  timeoutMs?: number;
  /** Başarı sayılan çıkış kodları. Varsayılan [0]. */
  okCodes?: number[];
}

/**
 * git'i argüman dizisiyle çalıştırır; hiçbir durumda reject etmez.
 *
 * `detached` süreci kontrol terminalinden koparır: git ya da ssh parola sormak için
 * terminali ele geçiremez, sormak yerine hata verir.
 */
export function runGit(cwd: string, args: string[], opts: RunGitOptions = {}): Promise<GitResult> {
  const { timeoutMs = 15000, okCodes = [0] } = opts;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn('git', args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    timer = setTimeout(() => {
      // Negatif pid: git'in başlattığı alt süreçler (hook, ssh) dahil tüm grup.
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Süreç zaten bitmiş.
      }
      finish({ ok: false, error: 'zaman aşımı', stdout });
    }, timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => finish({ ok: false, error: err.message, stdout }));
    child.on('close', (code) => {
      if (code !== null && okCodes.includes(code)) finish({ ok: true, stdout });
      else finish({ ok: false, error: pickErrorLine(stderr), stdout });
    });
  });
}

/** git'in hata çıktısından tek satırda gösterilecek en bilgilendirici satırı seçer. */
export function pickErrorLine(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const telling = lines.find((line) => /^(fatal|error):/.test(line) || line.includes('[rejected]'));
  return telling ?? lines.at(-1) ?? 'git başarısız oldu';
}
