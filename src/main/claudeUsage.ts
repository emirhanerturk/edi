import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeUsage, UsageWindow } from '../shared/api.js';

/**
 * Claude usage limits. Claude Code passes them only to the status line command;
 * the `resources/edi-statusline` bridge writes the `rate_limits` field to this file, and edi reads it.
 * No network access.
 */
export function usageFile(env: NodeJS.ProcessEnv, home: string): string {
  return env.EDI_USAGE_FILE || join(home, 'Library', 'Application Support', 'edi', 'claude-usage.json');
}

/** A file larger than this is not a usage file. */
const MAX_BYTES = 64 * 1024;

function windowOf(value: unknown, now: number): UsageWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { used_percentage: percent, resets_at: resetsAt } = value as Record<string, unknown>;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null;
  const at = resetsAt * 1000;
  // Once the reset time has passed, the percentage is no longer valid.
  return at > now ? { percent, resetsAt: at } : null;
}

/** The `rate_limits` JSON the bridge writes; null if there is no valid window. */
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

/** Reads the file; the update time is the file's modification time. Null if the file is missing or corrupt. */
export async function readUsage(file: string, now = Date.now()): Promise<ClaudeUsage | null> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_BYTES) return null;
    return parseUsage(await readFile(file, 'utf8'), info.mtimeMs, now);
  } catch {
    return null;
  }
}
