import { describe, expect, it } from 'vitest';
import { MAX_LINES, lineChanges } from '../../src/renderer/center/editor/lineChanges';

const text = (...lines: string[]) => lines.join('\n') + '\n';

describe('lineChanges', () => {
  it('nothing for the same text', () => {
    expect(lineChanges(text('a', 'b'), text('a', 'b'))).toEqual([]);
  });

  it('added lines, by their new line numbers', () => {
    expect(lineChanges(text('a', 'b'), text('a', 'x', 'y', 'b'))).toEqual([{ kind: 'added', start: 2, end: 3 }]);
    expect(lineChanges(text('a'), text('x', 'a'))).toEqual([{ kind: 'added', start: 1, end: 1 }]);
  });

  it('modified lines: removed and added in the same place', () => {
    expect(lineChanges(text('a', 'b', 'c'), text('a', 'B', 'c'))).toEqual([{ kind: 'modified', start: 2, end: 2 }]);
    // More lines than were removed: all count as modified.
    expect(lineChanges(text('a', 'b', 'c'), text('a', 'B1', 'B2', 'c'))).toEqual([{ kind: 'modified', start: 2, end: 3 }]);
  });

  it('deleted lines: a marker after the line before them (0 = above the first line)', () => {
    expect(lineChanges(text('a', 'b', 'c'), text('a', 'c'))).toEqual([{ kind: 'deleted', start: 1, end: 1 }]);
    expect(lineChanges(text('a', 'b'), text('b'))).toEqual([{ kind: 'deleted', start: 0, end: 0 }]);
  });

  it('several changes in one file', () => {
    const before = text('1', '2', '3', '4', '5', '6', '7');
    const after = text('1', 'new', '2', '3', '5', '6', 'SIX', '7');
    expect(lineChanges(before, after)).toEqual([
      { kind: 'added', start: 2, end: 2 },
      { kind: 'deleted', start: 4, end: 4 },
      { kind: 'added', start: 7, end: 7 },
    ]);
  });

  it('no HEAD version: every line is added; an empty file has none', () => {
    expect(lineChanges(null, text('a', 'b'))).toEqual([{ kind: 'added', start: 1, end: 2 }]);
    expect(lineChanges(null, '')).toEqual([]);
  });

  it('treats CRLF and LF line endings alike', () => {
    expect(lineChanges('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
  });

  it('gives up (null) on files over the line limit', () => {
    const big = 'x\n'.repeat(MAX_LINES + 1);
    expect(lineChanges(big, big + 'y\n')).toBeNull();
  });

  it('a completely rewritten file is one modified block', () => {
    const before = Array.from({ length: 300 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 300 }, (_, i) => `new ${i}`).join('\n');
    expect(lineChanges(before, after)).toEqual([{ kind: 'modified', start: 1, end: 300 }]);
  });
});
