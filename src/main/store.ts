import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Layout, RecentFolder } from '../shared/api.js';

export interface Persisted {
  lastDir: string | null;
  recent: RecentFolder[];
  layout: Layout;
  window: { x: number; y: number; width: number; height: number } | null;
}

export const DEFAULTS: Persisted = {
  lastDir: null,
  recent: [],
  layout: { left: 492, right: 372, diffMode: 'split', historyLayout: 'timeline' },
  window: null,
};

const RECENT_MAX = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** Dosyadan gelen her alan tek tek doğrulanır: elle bozulmuş ya da eski sürümden kalma dosya uygulamayı düşürmez. */
function normalize(raw: unknown): Persisted {
  if (!isRecord(raw)) return DEFAULTS;
  const layout = isRecord(raw.layout) ? raw.layout : {};
  const win = isRecord(raw.window) ? raw.window : null;
  const bounds = win && ['x', 'y', 'width', 'height'].every((key) => typeof win[key] === 'number' && Number.isFinite(win[key]));
  return {
    lastDir: typeof raw.lastDir === 'string' ? raw.lastDir : null,
    recent: (Array.isArray(raw.recent) ? raw.recent : [])
      .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.dir === 'string')
      .map((item) => ({ dir: item.dir as string, repoCount: num(item.repoCount, 0) }))
      .slice(0, RECENT_MAX),
    layout: {
      left: num(layout.left, DEFAULTS.layout.left),
      right: num(layout.right, DEFAULTS.layout.right),
      diffMode: oneOf(layout.diffMode, ['split', 'inline'] as const, DEFAULTS.layout.diffMode),
      historyLayout: oneOf(layout.historyLayout, ['timeline', 'byRepo'] as const, DEFAULTS.layout.historyLayout),
    },
    window: win && bounds ? { x: win.x as number, y: win.y as number, width: win.width as number, height: win.height as number } : null,
  };
}

export async function loadState(file: string): Promise<Persisted> {
  try {
    return normalize(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return DEFAULTS;
  }
}

/** Önce geçici dosyaya yazar, sonra adını değiştirir: yarıda kesilen yazma eski dosyayı bozmaz. */
export async function saveState(file: string, state: Persisted): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmp, file);
}

export function addRecent(state: Persisted, dir: string, repoCount: number): Persisted {
  const recent = [{ dir, repoCount }, ...state.recent.filter((item) => item.dir !== dir)].slice(0, RECENT_MAX);
  return { ...state, recent };
}
