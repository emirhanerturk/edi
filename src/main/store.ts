import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Layout, RecentFolder } from '../shared/api.js';

export interface Persisted {
  lastDir: string | null;
  recent: RecentFolder[];
  layout: Layout;
  window: { x: number; y: number; width: number; height: number } | null;
  /** Fetch every repo with a remote every few minutes (View > Fetch Automatically). */
  autoFetch: boolean;
}

export const DEFAULTS: Persisted = {
  lastDir: null,
  recent: [],
  layout: { left: 492, right: 372, diffMode: 'split', historyLayout: 'timeline', terminals: 'left' },
  window: null,
  autoFetch: true,
};

const RECENT_MAX = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** Every field from the file is validated one by one: a hand-corrupted file or one left by an old version doesn't crash the app. */
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
      terminals: oneOf(layout.terminals, ['left', 'right'] as const, DEFAULTS.layout.terminals),
    },
    window: win && bounds ? { x: win.x as number, y: win.y as number, width: win.width as number, height: win.height as number } : null,
    autoFetch: typeof raw.autoFetch === 'boolean' ? raw.autoFetch : DEFAULTS.autoFetch,
  };
}

/** The narrowest and widest panel that can be saved. */
const WIDTH_MIN = 200;
const WIDTH_MAX = 4000;
const width = (value: unknown, current: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= WIDTH_MIN && value <= WIDTH_MAX ? Math.round(value) : current;

/** Applies a layout change from the page. The page isn't trusted: every invalid field is ignored. */
export function mergeLayout(layout: Layout, patch: unknown): Layout {
  if (!isRecord(patch)) return layout;
  return {
    left: width(patch.left, layout.left),
    right: width(patch.right, layout.right),
    diffMode: oneOf(patch.diffMode, ['split', 'inline'] as const, layout.diffMode),
    historyLayout: oneOf(patch.historyLayout, ['timeline', 'byRepo'] as const, layout.historyLayout),
    terminals: oneOf(patch.terminals, ['left', 'right'] as const, layout.terminals),
  };
}

export async function loadState(file: string): Promise<Persisted> {
  try {
    return normalize(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return DEFAULTS;
  }
}

/** Writes to a temp file first, then renames it: an interrupted write doesn't corrupt the old file. */
export async function saveState(file: string, state: Persisted): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmp, file);
}

/**
 * The same write, done before returning: for when the app is about to exit and a pending write may
 * never finish. Its own temporary file, so it can't collide with an asynchronous write in progress.
 */
export function saveStateSync(file: string, state: Persisted): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.sync.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

export function addRecent(state: Persisted, dir: string, repoCount: number): Persisted {
  const recent = [{ dir, repoCount }, ...state.recent.filter((item) => item.dir !== dir)].slice(0, RECENT_MAX);
  return { ...state, recent };
}
