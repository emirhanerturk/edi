import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, addRecent, loadState, saveState } from '../src/main/store.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

describe('kalıcı durum', () => {
  it('dosya yoksa varsayılanlar', async () => {
    expect(await loadState(join(await makeTmpDir(), 'state.json'))).toEqual(DEFAULTS);
    expect(DEFAULTS.layout).toEqual({ left: 492, right: 372, diffMode: 'split', historyLayout: 'timeline' });
  });

  it('bozuk JSON varsayılanlara döner', async () => {
    const file = join(await makeTmpDir(), 'state.json');
    await writeFile(file, '{ bozuk');
    expect(await loadState(file)).toEqual(DEFAULTS);
    await writeFile(file, '[1, 2]');
    expect(await loadState(file)).toEqual(DEFAULTS);
  });

  it('eksik ve yanlış türdeki alanlar varsayılanla tamamlanır', async () => {
    const file = join(await makeTmpDir(), 'state.json');
    await writeFile(
      file,
      JSON.stringify({
        lastDir: '/a/b',
        layout: { right: 420, diffMode: 'yan yana', left: 'geniş' },
        recent: [{ dir: '/a/b', repoCount: 3 }, { dir: 7 }, 'x'],
        window: { x: 1, y: 2, width: 'çok' },
      }),
    );
    expect(await loadState(file)).toEqual({
      lastDir: '/a/b',
      recent: [{ dir: '/a/b', repoCount: 3 }],
      layout: { left: 492, right: 420, diffMode: 'split', historyLayout: 'timeline' },
      window: null,
    });
  });

  it('addRecent yineleneni başa alır ve 8 ile sınırlar', () => {
    let state = DEFAULTS;
    for (let i = 1; i <= 9; i++) state = addRecent(state, `/d/${i}`, i);
    expect(state.recent.map((r) => r.dir)).toEqual(['/d/9', '/d/8', '/d/7', '/d/6', '/d/5', '/d/4', '/d/3', '/d/2']);

    state = addRecent(state, '/d/5', 50);
    expect(state.recent.slice(0, 2)).toEqual([
      { dir: '/d/5', repoCount: 50 },
      { dir: '/d/9', repoCount: 9 },
    ]);
    expect(state.recent).toHaveLength(8);
    expect(DEFAULTS.recent).toEqual([]); // girdi değiştirilmez
  });

  it('saveState sonra loadState aynı değeri verir, klasörü kendisi açar', async () => {
    const file = join(await makeTmpDir(), 'iç', 'state.json');
    const state = {
      lastDir: '/a/klasör',
      recent: [{ dir: '/a/klasör', repoCount: 2 }],
      layout: { left: 500, right: 400, diffMode: 'inline' as const, historyLayout: 'byRepo' as const },
      window: { x: 10, y: 20, width: 1200, height: 800 },
    };
    await saveState(file, state);
    expect(await loadState(file)).toEqual(state);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(state);
  });
});
