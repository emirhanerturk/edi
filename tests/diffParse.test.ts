import { describe, expect, it } from 'vitest';
import { type Hunk, parseDiff, splitRows } from '../src/git/diffParse.js';

const HEADER = ['diff --git a/app/play.tsx b/app/play.tsx', 'index 1a2b3c4..5d6e7f8 100644', '--- a/app/play.tsx', '+++ b/app/play.tsx'];

// The diff from docs/design/edi-ui/Main.dc.html.
const ARTBOARD = [
  ...HEADER,
  '@@ -38,12 +38,16 @@ export function PlayScreen() {',
  '   const { round, total, options } = useQuizRound(gameId);',
  '   const finished = round > total;',
  ' ',
  '   return (',
  '     <View style={styles.screen}>',
  '-      <AdBanner placement="music-quiz-top" />',
  '       <QuizHeader round={round} total={total} />',
  '       <AnswerGrid options={options} onPick={handlePick} />',
  '-      {finished && <ResultCard score={score} />}',
  '+      {finished && (',
  '+        <>',
  '+          <ResultCard score={score} />',
  '+          <AdBanner placement="music-quiz-result" />',
  '+        </>',
  '+      )}',
  '     </View>',
  '   );',
  ' }',
  '@@ -71,7 +75,7 @@ const styles = StyleSheet.create({',
  '   screen: {',
  '     flex: 1,',
  '-    paddingTop: 56,',
  '+    paddingTop: 16,',
  '     paddingHorizontal: 20,',
  '     backgroundColor: colors.surface,',
  '   },',
  '',
].join('\n');

describe('parseDiff', () => {
  it('reads hunk headers, line numbers and totals', () => {
    const diff = parseDiff(ARTBOARD);
    expect(diff).toMatchObject({ added: 7, removed: 3, binary: false });
    expect(diff.hunks.map((h) => h.header)).toEqual([
      '@@ -38,12 +38,16 @@ export function PlayScreen() {',
      '@@ -71,7 +75,7 @@ const styles = StyleSheet.create({',
    ]);
    const first = diff.hunks[0]!.lines;
    expect(first[0]).toEqual({ kind: 'context', oldNo: 38, newNo: 38, text: '  const { round, total, options } = useQuizRound(gameId);' });
    expect(first[2]).toEqual({ kind: 'context', oldNo: 40, newNo: 40, text: '' });
    expect(first[5]).toEqual({ kind: 'del', oldNo: 43, text: '      <AdBanner placement="music-quiz-top" />' });
    expect(first[6]).toMatchObject({ kind: 'context', oldNo: 44, newNo: 43 });
    expect(first[8]).toMatchObject({ kind: 'del', oldNo: 46 });
    expect(first[9]).toEqual({ kind: 'add', newNo: 45, text: '      {finished && (' });
    expect(first.at(-1)).toEqual({ kind: 'context', oldNo: 49, newNo: 53, text: '}' });
    expect(diff.hunks[1]!.lines[2]).toEqual({ kind: 'del', oldNo: 73, text: '    paddingTop: 56,' });
    expect(diff.hunks[1]!.lines[3]).toEqual({ kind: 'add', newNo: 77, text: '    paddingTop: 16,' });
  });

  it('treats a header without counts as length 1', () => {
    const diff = parseDiff([...HEADER, '@@ -1 +1 @@', '-old', '+new', ''].join('\n'));
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: 'del', oldNo: 1, text: 'old' },
      { kind: 'add', newNo: 1, text: 'new' },
    ]);
  });

  it('a new file is all additions', () => {
    const diff = parseDiff(
      ['diff --git a/new.txt b/new.txt', 'new file mode 100644', 'index 0000000..e69de29', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1,2 @@', '+one', '+two', ''].join('\n'),
    );
    expect(diff).toMatchObject({ added: 2, removed: 0 });
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: 'add', newNo: 1, text: 'one' },
      { kind: 'add', newNo: 2, text: 'two' },
    ]);
  });

  it('a deleted file is all deletions', () => {
    const diff = parseDiff(
      ['diff --git a/old.txt b/old.txt', 'deleted file mode 100644', 'index e69de29..0000000', '--- a/old.txt', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-one', '-two', ''].join('\n'),
    );
    expect(diff).toMatchObject({ added: 0, removed: 2 });
    expect(diff.hunks[0]!.lines.map((l) => l.kind)).toEqual(['del', 'del']);
  });

  it('skips rename headers', () => {
    const diff = parseDiff(
      ['diff --git a/a.txt b/b.txt', 'similarity index 80%', 'rename from a.txt', 'rename to b.txt', 'index 1..2 100644', '--- a/a.txt', '+++ b/b.txt', '@@ -1,2 +1,2 @@', ' same', '-old', '+new', ''].join('\n'),
    );
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.hunks).toHaveLength(1);
  });

  it('has no hunks for a rename without content changes', () => {
    const diff = parseDiff(['diff --git a/a.txt b/b.txt', 'similarity index 100%', 'rename from a.txt', 'rename to b.txt', ''].join('\n'));
    expect(diff).toEqual({ hunks: [], added: 0, removed: 0, binary: false });
  });

  it('does not count the "No newline at end of file" marker as a line', () => {
    const diff = parseDiff([...HEADER, '@@ -1 +1 @@', '-old', '\\ No newline at end of file', '+new', '\\ No newline at end of file', ''].join('\n'));
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.hunks[0]!.lines).toHaveLength(2);
  });

  it('keeps \\r out of the text with CRLF line endings', () => {
    const diff = parseDiff([...HEADER, '@@ -1,2 +1,2 @@', ' same\r', '-old\r', '+new\r', ''].join('\n'));
    expect(diff.hunks[0]!.lines.map((l) => l.text)).toEqual(['same', 'old', 'new']);
  });

  it('detects a binary file', () => {
    const diff = parseDiff(['diff --git a/a.png b/a.png', 'index 1..2 100644', 'Binary files a/a.png and b/a.png differ', ''].join('\n'));
    expect(diff).toEqual({ hunks: [], added: 0, removed: 0, binary: true });
  });

  it('returns an empty result for empty text', () => {
    expect(parseDiff('')).toEqual({ hunks: [], added: 0, removed: 0, binary: false });
  });

  it('treats lines starting with "--- " and "+++ " inside a hunk as changes, not headers', () => {
    // When the deleted line is "-- sql comment" and the added one "++ counter", the diff shows "--- sql comment" and "+++ counter".
    const diff = parseDiff([...HEADER, '@@ -1,3 +1,3 @@', ' same', '--- sql comment', '+++ counter', ' last', ''].join('\n'));
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'same' },
      { kind: 'del', oldNo: 2, text: '-- sql comment' },
      { kind: 'add', newNo: 2, text: '++ counter' },
      { kind: 'context', oldNo: 3, newNo: 3, text: 'last' },
    ]);
  });

  it('does not start a new hunk at a content line starting with "@@"', () => {
    const diff = parseDiff([...HEADER, '@@ -1,2 +1,2 @@', ' @@ this is a content line', '-a', '+b', ''].join('\n'));
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]!.lines[0]).toMatchObject({ kind: 'context', text: '@@ this is a content line' });
  });
});

describe('splitRows', () => {
  it('produces the side-by-side layout from the design', () => {
    const rows = splitRows(parseDiff(ARTBOARD).hunks[0]!);
    const brief = rows.map((r) => [r.left?.no ?? null, r.right?.no ?? null, (r.left ?? r.right)!.changed]);
    expect(brief).toEqual([
      [38, 38, false],
      [39, 39, false],
      [40, 40, false],
      [41, 41, false],
      [42, 42, false],
      [43, null, true],
      [44, 43, false],
      [45, 44, false],
      [46, 45, true],
      [null, 46, true],
      [null, 47, true],
      [null, 48, true],
      [null, 49, true],
      [null, 50, true],
      [47, 51, false],
      [48, 52, false],
      [49, 53, false],
    ]);
    expect(rows[8]).toEqual({
      left: { no: 46, text: '      {finished && <ResultCard score={score} />}', changed: true },
      right: { no: 45, text: '      {finished && (', changed: true },
    });
  });

  it('leaves the right side empty when there are more deletions than additions', () => {
    const hunk: Hunk = {
      header: '@@ -1,3 +1,1 @@',
      lines: [
        { kind: 'del', oldNo: 1, text: 'a' },
        { kind: 'del', oldNo: 2, text: 'b' },
        { kind: 'del', oldNo: 3, text: 'c' },
        { kind: 'add', newNo: 1, text: 'x' },
      ],
    };
    expect(splitRows(hunk).map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', 'x'],
      ['b', null],
      ['c', null],
    ]);
  });

  it('resets pairing when context comes in between', () => {
    const hunk: Hunk = {
      header: '@@ -1,3 +1,3 @@',
      lines: [
        { kind: 'del', oldNo: 1, text: 'a' },
        { kind: 'context', oldNo: 2, newNo: 1, text: 'middle' },
        { kind: 'add', newNo: 2, text: 'x' },
      ],
    };
    expect(splitRows(hunk).map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', null],
      ['middle', 'middle'],
      [null, 'x'],
    ]);
  });
});
