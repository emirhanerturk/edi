import { execFile } from 'node:child_process';
import { sep } from 'node:path';
import type { Repo } from './git/discover.js';

/** Çıkış kodu ne olursa olsun stdout'u döner; komut hiç çalışamazsa boş metin. */
function output(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''));
  });
}

/** `lsof -Fpn` çıktısındaki yolları ('n' ile başlayan satırlar) çıkarır. */
export function parseLsofCwd(out: string): string[] {
  return out
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1));
}

/**
 * Açık Claude Code oturumlarının çalışma dizinleri. Tespit edilemezse boş dizi:
 * gösterge bir kolaylık, hatası kullanıcıyı ilgilendirmez.
 */
export async function listClaudeCwds(): Promise<string[]> {
  // pgrep eşleşme yoksa, lsof listelenen süreçlerden biri bu arada kapandıysa 1 ile çıkar;
  // ikisinde de stdout geçerlidir.
  const pids = (await output('pgrep', ['-x', 'claude'])).split('\n').filter((pid) => /^\d+$/.test(pid));
  if (pids.length === 0) return [];
  return parseLsofCwd(await output('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn']));
}

const isInside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

/**
 * Her oturumu içinde olduğu repoya; hiçbir repoda değil ama taranan klasörün içindeyse köke yazar.
 * Karşılaştırma yol bölütü sınırıyla yapılır: `quizei-app-next-quiz`, `quizei-app`'in içinde sayılmaz.
 */
export function assignSessions(
  cwds: string[],
  dir: string,
  repos: Repo[],
): { root: number; byRepo: Record<string, number> } {
  const byRepo: Record<string, number> = {};
  let root = 0;
  for (const cwd of cwds) {
    const repo = repos.find((candidate) => isInside(cwd, candidate.path));
    if (repo) byRepo[repo.path] = (byRepo[repo.path] ?? 0) + 1;
    else if (isInside(cwd, dir)) root++;
  }
  return { root, byRepo };
}
