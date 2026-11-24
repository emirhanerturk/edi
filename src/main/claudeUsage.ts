import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeUsage, UsageWindow } from '../shared/api.js';

/**
 * Claude kullanım limitleri. Claude Code bunları yalnız durum satırı komutuna verir;
 * `resources/edi-statusline` köprüsü `rate_limits` alanını bu dosyaya yazar, edi okur.
 * Ağa çıkılmaz.
 */
export function usageFile(env: NodeJS.ProcessEnv, home: string): string {
  return env.EDI_USAGE_FILE || join(home, 'Library', 'Application Support', 'edi', 'claude-usage.json');
}

/** Bundan büyük dosya kullanım dosyası değildir. */
const MAX_BYTES = 64 * 1024;

function windowOf(value: unknown, now: number): UsageWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { used_percentage: percent, resets_at: resetsAt } = value as Record<string, unknown>;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null;
  const at = resetsAt * 1000;
  // Sıfırlanma anı geçtiyse yüzde artık geçerli değildir.
  return at > now ? { percent, resetsAt: at } : null;
}

/** Köprünün yazdığı `rate_limits` JSON'u; geçerli pencere yoksa null. */
export function parseUsage(text: string, updatedAt: number, now: number): ClaudeUsage | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const limits = data as Record<string, unknown>;
  const fiveHour = windowOf(limits.five_hour, now);
  const week = windowOf(limits.seven_day, now);
  if (!fiveHour && !week) return null;
  return { fiveHour, week, updatedAt };
}

/** Dosyayı okur; güncellenme anı dosyanın değişme zamanıdır. Dosya yoksa ya da bozuksa null. */
export async function readUsage(file: string, now = Date.now()): Promise<ClaudeUsage | null> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_BYTES) return null;
    return parseUsage(await readFile(file, 'utf8'), info.mtimeMs, now);
  } catch {
    return null;
  }
}
