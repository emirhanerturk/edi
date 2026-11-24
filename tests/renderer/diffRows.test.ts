import { describe, expect, it } from 'vitest';
import { parseDiff } from '../../src/git/diffParse';
import { diffRows } from '../../src/renderer/center/diffRows';

const DIFF = parseDiff(
  ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,4 @@ function a() {', ' bir', '-iki', '+İKİ', '+iki buçuk', ' üç', '@@ -10 +11 @@', '-on', '+ON', ''].join('\n'),
);

describe('diffRows', () => {
  it('split: hunk headers and paired lines', () => {
    const { rows, truncated } = diffRows(DIFF, 'split');
    expect(truncated).toBe(false);
    expect(rows).toEqual([
      { type: 'hunk', text: '@@ -1,3 +1,4 @@ function a() {' },
      { type: 'split', left: { no: 1, text: 'bir', kind: 'context' }, right: { no: 1, text: 'bir', kind: 'context' } },
      { type: 'split', left: { no: 2, text: 'iki', kind: 'del' }, right: { no: 2, text: 'İKİ', kind: 'add' } },
      { type: 'split', left: null, right: { no: 3, text: 'iki buçuk', kind: 'add' } },
      { type: 'split', left: { no: 3, text: 'üç', kind: 'context' }, right: { no: 4, text: 'üç', kind: 'context' } },
      { type: 'hunk', text: '@@ -10 +11 @@' },
      { type: 'split', left: { no: 10, text: 'on', kind: 'del' }, right: { no: 11, text: 'ON', kind: 'add' } },
    ]);
  });

  it('inline: every line with both numbers, in diff order', () => {
    const { rows } = diffRows(DIFF, 'inline');
    expect(rows.slice(0, 5)).toEqual([
      { type: 'hunk', text: '@@ -1,3 +1,4 @@ function a() {' },
      { type: 'inline', kind: 'context', oldNo: 1, newNo: 1, text: 'bir' },
      { type: 'inline', kind: 'del', oldNo: 2, newNo: null, text: 'iki' },
      { type: 'inline', kind: 'add', oldNo: null, newNo: 2, text: 'İKİ' },
      { type: 'inline', kind: 'add', oldNo: null, newNo: 3, text: 'iki buçuk' },
    ]);
  });

  it('cuts a very long diff at the limit and reports it', () => {
    const inline = diffRows(DIFF, 'inline', 3);
    expect(inline.truncated).toBe(true);
    expect(inline.rows.filter((row) => row.type === 'inline')).toHaveLength(3);
    const split = diffRows(DIFF, 'split', 3);
    expect(split.truncated).toBe(true);
    // The first three diff lines: bir, -iki, +İKİ.
    expect(split.rows).toHaveLength(3);
    expect(diffRows(DIFF, 'inline', 7).truncated).toBe(false);
  });

  it('an empty diff gives an empty row list', () => {
    expect(diffRows(parseDiff(''), 'split')).toEqual({ rows: [], truncated: false });
  });
});
