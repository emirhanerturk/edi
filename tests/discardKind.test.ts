import { describe, expect, it } from 'vitest';
import { discardHow } from '../src/git/discardKind.js';
import type { FileChange } from '../src/git/types.js';

const f = (path: string, x: string, y: string, kind: FileChange['kind'] = 'changed', origPath: string | null = null): FileChange => ({ path, origPath, x, y, kind });

describe('discardHow', () => {
  it('tracked changes are restored', () => {
    expect(discardHow(f('a.ts', '.', 'M'))).toEqual({ how: 'restore' });
    expect(discardHow(f('a.ts', 'M', 'M'))).toEqual({ how: 'restore' });
    expect(discardHow(f('a.ts', '.', 'D'))).toEqual({ how: 'restore' });
  });

  it('new files go to the Trash; an intent-to-add one leaves the index first', () => {
    expect(discardHow(f('n.ts', '?', '?', 'untracked'))).toEqual({ how: 'trash' });
    expect(discardHow(f('n.ts', '.', 'A'))).toEqual({ how: 'untrack-and-trash' });
  });

  it('a nested repository, an intent-to-add rename, a conflict or nothing unstaged are refused with a reason', () => {
    expect(discardHow(f('nested/', '?', '?', 'untracked'))).toEqual({ how: 'refuse', reason: 'A repository inside this one is left alone' });
    expect(discardHow(f('new.ts', '.', 'R', 'changed', 'old.ts'))).toEqual({ how: 'refuse', reason: 'A rename made with git add -N: discard it in a terminal' });
    expect(discardHow(f('c.ts', 'U', 'U', 'conflicted'))).toEqual({ how: 'refuse', reason: 'Resolve the conflicts first' });
    expect(discardHow(f('s.ts', 'M', '.'))).toEqual({ how: 'refuse', reason: 'Nothing to discard' });
  });
});
