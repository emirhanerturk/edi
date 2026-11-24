import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';

export type GitResult = { ok: true; stdout: string } | { ok: false; error: string; stdout: string };

export interface RunGitOptions {
  /** Varsayılan 15000. Aşılırsa süreç grubu sonlandırılır. */
  timeoutMs?: number;
  /** Başarı sayılan çıkış kodları. Varsayılan [0]. */
  okCodes?: number[];
}

/** SIGTERM'den sonra sürecin kendi kendine kapanması için tanınan süre. */
const KILL_GRACE_MS = 2000;

/** Komutu `cwd` dışındaki bir repoya yönlendirebilecek ortam değişkenleri. */
const REDIRECTING_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_NAMESPACE',
];

function gitEnv(cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const name of REDIRECTING_VARS) delete env[name];
  // git, `cwd` repo değilse üst klasörlerde repo aramaya çıkar. Tavan, bir satırın
  // komutunun yanlışlıkla üstteki başka bir repoda çalışmasını engeller.
  env.GIT_CEILING_DIRECTORIES = [dirname(cwd), process.env.GIT_CEILING_DIRECTORIES].filter(Boolean).join(':');
  return env;
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
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(result);
    };

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn('git', args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(cwd) });
    } catch (err) {
      // Örn. NUL içeren argüman: spawn eşzamanlı olarak throw eder.
      finish({ ok: false, error: err instanceof Error ? err.message : String(err), stdout: '' });
      return;
    }

    // Negatif pid: git'in başlattığı alt süreçler (hook, ssh) dahil tüm grup.
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // Süreç zaten bitmiş.
      }
    };

    timer = setTimeout(() => {
      timedOut = true;
      // Önce SIGTERM: git kilit dosyalarını (index.lock) temizleyerek çıkar.
      // SIGKILL kilidi geride bırakır ve repodaki sonraki tüm yazma işlemleri kilitlenir.
      killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
        finish({ ok: false, error: 'zaman aşımı', stdout });
      }, KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => finish({ ok: false, error: err.message, stdout }));
    child.on('close', (code) => {
      if (timedOut) finish({ ok: false, error: 'zaman aşımı', stdout });
      else if (code !== null && okCodes.includes(code)) finish({ ok: true, stdout });
      // Bazı git hataları ("nothing to commit" gibi) stderr'e değil stdout'a yazılır.
      else finish({ ok: false, error: pickErrorLine(stderr.trim() === '' ? stdout : stderr), stdout });
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
