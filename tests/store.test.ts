import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadState, mergeLayout, saveState, saveStateSync } from '../src/main/store.js';
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
        projects: [
          { id: 'p1', dir: '/a/b', name: '  Quizei ', logo: { kind: 'letter', color: 'teal' }, links: 'none', openedAt: 'yesterday', repoCount: 3 },
          { id: 'p2', dir: 'relative', name: 'x' },
          { id: 'p3', dir: '/a/b', name: 'a second one for the same folder' },
          'x',
        ],
        layout: { right: 420, diffMode: 'side by side', left: 'wide', terminals: 'middle' },
        window: { x: 1, y: 2, width: 'lots' },
        autoFetch: 'no',
        keepAwake: 1,
      }),
    );
    const state = await loadState(file);
    expect(state.projects).toEqual([
      { id: 'p1', dir: '/a/b', name: 'Quizei', logo: { kind: 'letter', color: expect.any(String) }, links: [], openedAt: 0, repoCount: 3, repos: { order: [], ignored: [] } },
    ]);
    expect(state).toEqual({
      projects: state.projects,
      layout: { left: 492, right: 420, diffMode: 'split', historyLayout: 'timeline', terminals: 'left' },
      window: null,
      autoFetch: true,
      keepAwake: false,
    });
  });

  it('turns the recent folders of a file from before projects into projects, the last folder opened first', async () => {
    const file = join(await makeTmpDir(), 'state.json');
    await writeFile(
      file,
      JSON.stringify({
        lastDir: '/s/quizei',
        recent: [
          { dir: '/s/quizei', repoCount: 8 },
          { dir: '/s/beremo', repoCount: 1 },
          { dir: 7 },
          'x',
        ],
      }),
    );
    const { projects } = await loadState(file, 1_000);
    expect(projects.map(({ dir, name, openedAt, repoCount, links }) => ({ dir, name, openedAt, repoCount, links }))).toEqual([
      { dir: '/s/quizei', name: 'quizei', openedAt: 1_000, repoCount: 8, links: [] },
      { dir: '/s/beremo', name: 'beremo', openedAt: 0, repoCount: 1, links: [] },
    ]);
    expect(projects.every((project) => project.logo.kind === 'letter')).toBe(true);
    expect(new Set(projects.map((project) => project.id)).size).toBe(2);
  });

  it('round-trips through saveState and loadState and creates the folder itself', async () => {
    const file = join(await makeTmpDir(), 'nested', 'state.json');
    const state = {
      projects: [
        {
          id: 'a1b2-c3',
          dir: '/a/klasör',
          name: 'Klasör',
          logo: { kind: 'image' as const, file: 'a1b2-c3-0f0f0f0f.svg' },
          links: [{ url: 'https://quizei.com/', label: 'Site' }],
          openedAt: 1_700_000_000_000,
          repoCount: 2,
          repos: { order: [], ignored: [] },
        },
      ],
      layout: { left: 500, right: 400, diffMode: 'inline' as const, historyLayout: 'byRepo' as const, terminals: 'right' as const },
      window: { x: 10, y: 20, width: 1200, height: 800 },
      autoFetch: false,
      keepAwake: true,
    };
    await saveState(file, state);
    expect(await loadState(file)).toEqual(state);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(state);
  });

  it('saveStateSync writes the same file before returning, leaving no temporary file', async () => {
    const dir = await makeTmpDir();
    const file = join(dir, 'nested', 'state.json');
    const state = { ...DEFAULTS, autoFetch: false };
    saveStateSync(file, state);
    expect(await loadState(file)).toEqual(state);
    expect(await readdir(join(dir, 'nested'))).toEqual(['state.json']);
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
