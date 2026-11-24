import { describe, expect, it } from 'vitest';
import { type Hunk, parseDiff, splitRows } from '../src/git/diffParse.js';

const HEADER = ['diff --git a/app/play.tsx b/app/play.tsx', 'index 1a2b3c4..5d6e7f8 100644', '--- a/app/play.tsx', '+++ b/app/play.tsx'];

// docs/design/edi-ui/Main.dc.html içindeki diff.
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
  it('hunk başlıklarını, satır numaralarını ve toplamları okur', () => {
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

  it('sayısız başlıkta uzunluk 1 sayılır', () => {
    const diff = parseDiff([...HEADER, '@@ -1 +1 @@', '-eski', '+yeni', ''].join('\n'));
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: 'del', oldNo: 1, text: 'eski' },
      { kind: 'add', newNo: 1, text: 'yeni' },
    ]);
  });

  it('yeni dosya: tamamı ekleme', () => {
    const diff = parseDiff(
      ['diff --git a/yeni.txt b/yeni.txt', 'new file mode 100644', 'index 0000000..e69de29', '--- /dev/null', '+++ b/yeni.txt', '@@ -0,0 +1,2 @@', '+bir', '+iki', ''].join('\n'),
    );
    expect(diff).toMatchObject({ added: 2, removed: 0 });
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: 'add', newNo: 1, text: 'bir' },
      { kind: 'add', newNo: 2, text: 'iki' },
    ]);
  });

  it('silinen dosya: tamamı silme', () => {
    const diff = parseDiff(
      ['diff --git a/eski.txt b/eski.txt', 'deleted file mode 100644', 'index e69de29..0000000', '--- a/eski.txt', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-bir', '-iki', ''].join('\n'),
    );
    expect(diff).toMatchObject({ added: 0, removed: 2 });
    expect(diff.hunks[0]!.lines.map((l) => l.kind)).toEqual(['del', 'del']);
  });

  it('yeniden adlandırma başlıklarını atlar', () => {
    const diff = parseDiff(
      ['diff --git a/a.txt b/b.txt', 'similarity index 80%', 'rename from a.txt', 'rename to b.txt', 'index 1..2 100644', '--- a/a.txt', '+++ b/b.txt', '@@ -1,2 +1,2 @@', ' aynı', '-eski', '+yeni', ''].join('\n'),
    );
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.hunks).toHaveLength(1);
  });

  it('içeriği değişmeyen yeniden adlandırmada hunk yoktur', () => {
    const diff = parseDiff(['diff --git a/a.txt b/b.txt', 'similarity index 100%', 'rename from a.txt', 'rename to b.txt', ''].join('\n'));
    expect(diff).toEqual({ hunks: [], added: 0, removed: 0, binary: false });
  });

  it('"No newline at end of file" işaretini satır saymaz', () => {
    const diff = parseDiff([...HEADER, '@@ -1 +1 @@', '-eski', '\\ No newline at end of file', '+yeni', '\\ No newline at end of file', ''].join('\n'));
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.hunks[0]!.lines).toHaveLength(2);
  });

  it('CRLF satır sonlarında \\r metne girmez', () => {
    const diff = parseDiff([...HEADER, '@@ -1,2 +1,2 @@', ' aynı\r', '-eski\r', '+yeni\r', ''].join('\n'));
    expect(diff.hunks[0]!.lines.map((l) => l.text)).toEqual(['aynı', 'eski', 'yeni']);
  });

  it('ikili dosyayı tanır', () => {
    const diff = parseDiff(['diff --git a/a.png b/a.png', 'index 1..2 100644', 'Binary files a/a.png and b/a.png differ', ''].join('\n'));
    expect(diff).toEqual({ hunks: [], added: 0, removed: 0, binary: true });
  });

  it('boş metinde boş sonuç', () => {
    expect(parseDiff('')).toEqual({ hunks: [], added: 0, removed: 0, binary: false });
  });

  it('hunk içinde "--- " ve "+++ " ile başlayan satırlar değişikliktir, başlık değil', () => {
    // Silinen satır "-- sql yorumu", eklenen satır "++ sayaç" ise diff'te "--- sql yorumu" ve "+++ sayaç" görünür.
    const diff = parseDiff([...HEADER, '@@ -1,3 +1,3 @@', ' aynı', '--- sql yorumu', '+++ sayaç', ' son', ''].join('\n'));
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'aynı' },
      { kind: 'del', oldNo: 2, text: '-- sql yorumu' },
      { kind: 'add', newNo: 2, text: '++ sayaç' },
      { kind: 'context', oldNo: 3, newNo: 3, text: 'son' },
    ]);
  });

  it('hunk içindeki "@@" ile başlayan içerik satırı yeni hunk açmaz', () => {
    const diff = parseDiff([...HEADER, '@@ -1,2 +1,2 @@', ' @@ bu bir içerik satırı', '-a', '+b', ''].join('\n'));
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]!.lines[0]).toMatchObject({ kind: 'context', text: '@@ bu bir içerik satırı' });
  });
});

describe('splitRows', () => {
  it('tasarımdaki yan yana düzeni üretir', () => {
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

  it('silinenler eklenenlerden çoksa sağ taraf boş kalır', () => {
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

  it('araya bağlam girince eşleştirme sıfırlanır', () => {
    const hunk: Hunk = {
      header: '@@ -1,3 +1,3 @@',
      lines: [
        { kind: 'del', oldNo: 1, text: 'a' },
        { kind: 'context', oldNo: 2, newNo: 1, text: 'orta' },
        { kind: 'add', newNo: 2, text: 'x' },
      ],
    };
    expect(splitRows(hunk).map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', null],
      ['orta', 'orta'],
      [null, 'x'],
    ]);
  });
});
