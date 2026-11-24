import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import type { PsRow } from './procs.js';
import { parseLsofPidCwd } from './sessions.js';
import type { ServerInfo } from './shared/api.js';

/** Çıkış kodu ne olursa olsun stdout'u döner (lsof eşleşme yoksa 1 ile çıkar). */
export type Run = (cmd: string, args: string[]) => Promise<string>;

const run: Run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''));
  });

/** localhost'tan erişilebilen dinleme adresi: tüm adresler ya da geri döngü. */
function reachable(host: string): boolean {
  return host === '*' || host === '0.0.0.0' || host === '[::]' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * macOS'un `listen(0)` isteyenlere rastgele verdiği aralığın başı. Bu aralıktaki portlar
 * kimsenin yazmadığı iç portlardır (Claude Code, vite eklentileri, workerd); sunucu sayılmaz.
 */
export const EPHEMERAL_FIRST = 49152;

/** `lsof -Fpn` çıktısı: pid → localhost'tan erişilebilen, rastgele verilmemiş portlar (sıralı, tekrarsız). */
export function parseListening(out: string): Map<number, number[]> {
  const ports = new Map<number, Set<number>>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      pid = /^\d+$/.test(line.slice(1)) ? Number(line.slice(1)) : null;
      continue;
    }
    if (!line.startsWith('n') || pid === null) continue;
    const match = /^(.*):(\d+)$/.exec(line.slice(1));
    if (!match || !reachable(match[1]!)) continue;
    const port = Number(match[2]);
    if (port < 1 || port >= EPHEMERAL_FIRST) continue;
    if (!ports.has(pid)) ports.set(pid, new Set());
    ports.get(pid)!.add(port);
  }
  return new Map([...ports].map(([key, set]) => [key, [...set].sort((a, b) => a - b)]));
}

/** Claude Code'un kendisi: kendi iç portunu açar, sunucu değildir. Başlattığı alt süreçler sayılır. */
const isClaude = (args: string) => basename(args.split(' ')[0] ?? '') === 'claude';

/**
 * edi terminallerinin tty'sinde çalışan, kabuk ve Claude Code olmayan süreçler: pid → sekme.
 * Arka plandakiler (`&`) de sayılır.
 */
export function serverCandidates(ptys: { id: number; pid: number; tty: string }[], ps: PsRow[]): Map<number, number> {
  const tabByTty = new Map<string, number>();
  const shells = new Set<number>();
  for (const { id, pid, tty } of ptys) {
    // tty adı pty'den okunamadıysa kabuğun kendi süreç satırı söyler.
    const terminal = tty || (ps.find((row) => row.pid === pid)?.tty ?? '');
    if (terminal !== '') tabByTty.set(terminal, id);
    shells.add(pid);
  }
  const candidates = new Map<number, number>();
  for (const row of ps) {
    const tab = tabByTty.get(row.tty);
    if (tab !== undefined && !shells.has(row.pid) && !isClaude(row.args)) candidates.set(row.pid, tab);
  }
  return candidates;
}

/** Adayların dinlediği portlardan sunucu listesi: port sırasıyla, bir sekmede aynı port bir kez. */
export function serversFor(candidates: Map<number, number>, listening: Map<number, number[]>, cwds: Map<number, string>): ServerInfo[] {
  const servers = new Map<string, ServerInfo>();
  for (const [pid, ports] of [...listening].sort(([a], [b]) => a - b)) {
    const tabId = candidates.get(pid);
    if (tabId === undefined) continue;
    for (const port of ports) {
      const key = `${tabId}:${port}`;
      if (!servers.has(key)) servers.set(key, { tabId, port, pid, cwd: cwds.get(pid) ?? null });
    }
  }
  return [...servers.values()].sort((a, b) => a.port - b.port || a.tabId - b.tabId);
}

/** Verilen süreçlerin dinlediği TCP portları. */
export async function readListening(pids: number[], exec: Run = run): Promise<Map<number, number[]>> {
  return parseListening(await exec('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', pids.join(','), '-Fpn']));
}

/**
 * edi terminallerinde dinlemeye açılmış localhost portları. Kabuk dışı süreç yoksa lsof
 * çalıştırılmaz. Okunamazsa boş liste: liste bir kolaylık, hatası kullanıcıyı ilgilendirmez.
 */
export async function listServers(ptys: { id: number; pid: number; tty: string }[], ps: PsRow[], exec: Run = run): Promise<ServerInfo[]> {
  const candidates = serverCandidates(ptys, ps);
  if (candidates.size === 0) return [];
  try {
    const listening = await readListening([...candidates.keys()], exec);
    const pids = [...listening.keys()].filter((pid) => candidates.has(pid));
    if (pids.length === 0) return [];
    const cwds = parseLsofPidCwd(await exec('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn']));
    return serversFor(candidates, listening, cwds);
  } catch {
    return [];
  }
}
