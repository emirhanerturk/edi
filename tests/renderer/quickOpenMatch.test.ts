import { describe, expect, it } from 'vitest';
import { matchPath, normalize, runs, search } from '../../src/renderer/quickOpen/match';

describe('matchPath', () => {
  it('prefers the name, its start, then the path, then the letters in order', () => {
    const name = matchPath('model', 'src/api/models.ts')!;
    const later = matchPath('model', 'src/api/datamodel.ts')!;
    const inPath = matchPath('model', 'src/models/index.ts')!;
    const spread = matchPath('model', 'src/store/moduleLoader.ts')!;
    expect(name.positions).toEqual([8, 9, 10, 11, 12]);
    expect(name.score).toBeGreaterThan(later.score);
    expect(later.score).toBeGreaterThan(inPath.score);
    expect(inPath.score).toBeGreaterThan(spread.score);
    expect(matchPath('model', 'README.md')).toBeNull();
  });

  it('matches across folders as typed, and letters in order land in the name when they can', () => {
    expect(matchPath('api/mod', 'src/api/models.ts')!.positions).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(matchPath('rkscr', 'src/screens/RankingScreen.tsx')!.positions.every((at) => at > 'src/screens/'.length - 1)).toBe(true);
    expect(matchPath(normalize('Rank Screen'), 'src/screens/RankingScreen.tsx')).not.toBeNull();
  });
});

describe('runs', () => {
  it('splits a name into matched and unmatched runs', () => {
    expect(runs('models.ts', 8, [8, 9, 10, 11, 12])).toEqual([
      { text: 'model', hit: true },
      { text: 's.ts', hit: false },
    ]);
  });
});

describe('search', () => {
  it('groups by repo, the best file and the best group first', () => {
    const groups = search('model', [
      { repoPath: '/w/admin', files: ['lib/models.ts', 'components/ModelBadge.tsx', 'app/page.tsx'] },
      { repoPath: '/w/backend', files: ['src/models/user.model.ts', 'src/server.ts'] },
      { repoPath: '/w/web', files: ['index.html'] },
    ]);
    expect(groups.map((group) => [group.repoPath, group.hits.map((hit) => hit.path)])).toEqual([
      ['/w/admin', ['lib/models.ts', 'components/ModelBadge.tsx']],
      ['/w/backend', ['src/models/user.model.ts']],
    ]);
  });
});
