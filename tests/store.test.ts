import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, addRecent, loadState, mergeLayout, saveState } from '../src/main/store.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

describe('persistent state', () => {
  it('uses the defaults when the file is missing', async () => {
    expect(await loadState(join(await makeTmpDir(), 'state.json'))).toEqual(DEFAULTS);
    expect(DEFAULTS.layout).toEqual({ left: 492, right: 372, diffMode: 'split', historyLayout: 'timeline', terminals: 'left' });
  });

  it('falls back to the defaults on broken JSON', async () => {
    const file = join(await makeTmpDir(), 'state.json');
    await writeFile(file, '{ broken');
    expect(await loadState(file)).toEqual(DEFAULTS);
    await writeFile(file, '[1, 2]');
    expect(await loadState(file)).toEqual(DEFAULTS);
  });

  it('fills missing and wrongly typed fields with the defaults', async () => {
    const file = join(await makeTmpDir(), 'state.json');
    await writeFile(
      file,
      JSON.stringify({
        lastDir: '/a/b',
        layout: { right: 420, diffMode: 'side by side', left: 'wide', terminals: 'middle' },
        recent: [{ dir: '/a/b', repoCount: 3 }, { dir: 7 }, 'x'],
        window: { x: 1, y: 2, width: 'lots' },
        autoFetch: 'no',
      }),
    );
    expect(await loadState(file)).toEqual({
      lastDir: '/a/b',
      recent: [{ dir: '/a/b', repoCount: 3 }],
      layout: { left: 492, right: 420, diffMode: 'split', historyLayout: 'timeline', terminals: 'left' },
      window: null,
      autoFetch: true,
    });
  });

  it('addRecent moves a duplicate to the front and caps the list at 8', () => {
    let state = DEFAULTS;
    for (let i = 1; i <= 9; i++) state = addRecent(state, `/d/${i}`, i);
    expect(state.recent.map((r) => r.dir)).toEqual(['/d/9', '/d/8', '/d/7', '/d/6', '/d/5', '/d/4', '/d/3', '/d/2']);

    state = addRecent(state, '/d/5', 50);
    expect(state.recent.slice(0, 2)).toEqual([
      { dir: '/d/5', repoCount: 50 },
      { dir: '/d/9', repoCount: 9 },
    ]);
    expect(state.recent).toHaveLength(8);
    expect(DEFAULTS.recent).toEqual([]); // the input is not mutated
  });

  it('round-trips through saveState and loadState and creates the folder itself', async () => {
    const file = join(await makeTmpDir(), 'nested', 'state.json');
    const state = {
      lastDir: '/a/klasör',
      recent: [{ dir: '/a/klasör', repoCount: 2 }],
      layout: { left: 500, right: 400, diffMode: 'inline' as const, historyLayout: 'byRepo' as const, terminals: 'right' as const },
      window: { x: 10, y: 20, width: 1200, height: 800 },
      autoFetch: false,
    };
    await saveState(file, state);
    expect(await loadState(file)).toEqual(state);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(state);
  });
});

describe('mergeLayout', () => {
  const base = DEFAULTS.layout;

  it('applies the valid fields and keeps the rest', () => {
    expect(mergeLayout(base, { right: 450 })).toEqual({ ...base, right: 450 });
    expect(mergeLayout(base, { left: 600.4, diffMode: 'inline', historyLayout: 'byRepo', terminals: 'right' })).toEqual({
      left: 600,
      right: 372,
      diffMode: 'inline',
      historyLayout: 'byRepo',
      terminals: 'right',
    });
  });

  it('ignores broken values coming from the page', () => {
    expect(mergeLayout(base, { right: 'wide', left: Number.NaN, diffMode: 'side by side', historyLayout: 7, terminals: 'top' })).toEqual(base);
    expect(mergeLayout(base, { right: 1e9 })).toEqual(base);
    expect(mergeLayout(base, { right: 12 })).toEqual(base);
    expect(mergeLayout(base, { right: Number.POSITIVE_INFINITY })).toEqual(base);
    expect(mergeLayout(base, null)).toEqual(base);
    expect(mergeLayout(base, [1, 2])).toEqual(base);
    expect(mergeLayout(base, 'x')).toEqual(base);
  });

  it('does not carry unknown fields', () => {
    expect(mergeLayout(base, { right: 400, __proto__: { x: 1 }, extra: true })).toEqual({ ...base, right: 400 });
  });
});
