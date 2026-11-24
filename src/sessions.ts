import { execFile } from 'node:child_process';
import { sep } from 'node:path';
import type { Repo } from './git/discover.js';
import type { PsRow } from './procs.js';

/** Çıkış kodu ne olursa olsun stdout'u döner; komut hiç çalışamazsa boş metin. */
function output(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''));
  });
}

/** `lsof -Fpn` çıktısından her sürecin çalışma dizinini çıkarır ('p' satırı pid, 'n' satırı yol). */
export function parseLsofPidCwd(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** Çalışan Claude Code süreçleri. Tespit edilemezse boş dizi. */
export async function listClaudePids(): Promise<number[]> {
  // pgrep eşleşme yoksa 1 ile çıkar; stdout yine geçerlidir.
  return (await output('pgrep', ['-x', 'claude']))
    .split('\n')
    .filter((pid) => /^\d+$/.test(pid))
    .map(Number);
}

export interface ClaudeSession {
  pid: number;
  cwd: string;
  tty: string;
}

/**
 * Yalnız bir terminalde çalışan oturumlar sayılır: terminali olmayanlar (ör. bir editörün
 * arka planda çalıştırdığı) kullanıcının göremediği süreçlerdir.
 */
export function joinSessions(pids: number[], cwdByPid: ReadonlyMap<number, string>, ps: PsRow[]): ClaudeSession[] {
  const ttyByPid = new Map(ps.map((row) => [row.pid, row.tty]));
  const sessions: ClaudeSession[] = [];
  for (const pid of pids) {
    const cwd = cwdByPid.get(pid);
    const tty = ttyByPid.get(pid);
    if (cwd && tty) sessions.push({ pid, cwd, tty });
  }
  return sessions;
}

/**
 * Terminalde açık Claude Code oturumları. Tespit edilemezse boş dizi:
 * gösterge bir kolaylık, hatası kullanıcıyı ilgilendirmez.
 */
export async function listClaudeSessions(ps: PsRow[], pids: number[]): Promise<ClaudeSession[]> {
  const withTty = joinSessions(pids, new Map(pids.map((pid) => [pid, '-'])), ps).map((session) => session.pid);
  if (withTty.length === 0) return [];
  // lsof listelenen süreçlerden biri bu arada kapandıysa 1 ile çıkar; stdout yine geçerlidir.
  const cwds = parseLsofPidCwd(await output('lsof', ['-a', '-d', 'cwd', '-p', withTty.join(','), '-Fpn']));
  return joinSessions(withTty, cwds, ps);
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
