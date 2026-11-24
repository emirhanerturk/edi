import { describe, expect, it } from 'vitest';
import { parseDiff } from '../../src/git/diffParse';
import { MAX_HIGHLIGHT_CHARS, MAX_LINE_CHARS, highlightDiff, highlightLines } from '../../src/renderer/highlight/highlight';

const text = (tokens: { text: string }[]) => tokens.map((token) => token.text).join('');

describe('highlightLines', () => {
  it('returns one token list per line; the text is kept as is', async () => {
    const lines = await highlightLines('const a = 1;\n// x', 'a.ts');
    expect(lines).not.toBeNull();
    expect(lines!.map(text)).toEqual(['const a = 1;', '// x']);
  });

  it('a keyword and a comment get different colors', async () => {
    const lines = (await highlightLines('const a = 1;\n// x', 'a.ts'))!;
    const keyword = lines[0]!.find((token) => token.text.includes('const'))!;
    const comment = lines[1]!.find((token) => token.text.includes('x'))!;
    expect(keyword.color).toMatch(/^#[0-9a-f]{6}/i);
    expect(comment.color).toMatch(/^#[0-9a-f]{6}/i);
    expect(keyword.color.toLowerCase()).not.toBe(comment.color.toLowerCase());
  });

  it('uses the One Dark Pro colors', async () => {
    const lines = (await highlightLines("const s = 'x';", 'a.ts'))!;
    const colors = lines[0]!.map((token) => token.color.toLowerCase());
    expect(colors).toContain('#c678dd'); // keyword
    expect(colors).toContain('#98c379'); // string
  });

  it('loads other languages too, such as tsx and json', async () => {
    expect((await highlightLines('const a = <View />;', 'a.tsx'))!.map(text)).toEqual(['const a = <View />;']);
    expect((await highlightLines('{ "a": 1 }', 'a.json'))!.map(text)).toEqual(['{ "a": 1 }']);
  });

  it('null for an unknown language', async () => {
    expect(await highlightLines('x', 'a.xyz')).toBeNull();
    expect(await highlightLines('x', 'LICENSE')).toBeNull();
  });

  it('empty text is a single empty line', async () => {
    expect(await highlightLines('', 'a.ts')).toEqual([[]]);
  });

  it('empty lines and CRLF keep the line count right', async () => {
    const lines = (await highlightLines('a\r\n\r\nb\n', 'a.ts'))!;
    expect(lines.map(text)).toEqual(['a', '', 'b', '']);
  });

  it('does not highlight very long text', async () => {
    expect(await highlightLines('a'.repeat(MAX_HIGHLIGHT_CHARS + 1), 'a.ts')).toBeNull();
    expect(MAX_HIGHLIGHT_CHARS).toBe(200_000);
  });

  it('does not highlight text with a very long line, like a minified file (so the page does not freeze)', async () => {
    const long = `const a = [${'1,'.repeat(1000)}];`;
    expect(long.length).toBeGreaterThan(MAX_LINE_CHARS);
    expect(await highlightLines(`const x = 1;\n${long}`, 'a.min.js')).toBeNull();
    const fits = `const a = "${'x'.repeat(MAX_LINE_CHARS - 13)}";`;
    expect(fits.length).toBe(MAX_LINE_CHARS);
    expect(await highlightLines(fits, 'a.js')).toHaveLength(1);
  });
});

describe('highlightDiff', () => {
  const diff = parseDiff(
    ['--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,3 @@', ' const a = 1;', "-const b = 'old';", "+const b = 'new';", ' // end', '@@ -20 +20,2 @@', '-return a;', '+return a + b;', '+// extra', ''].join('\n'),
  );

  it('highlights the old and new side lines by line number', async () => {
    const tokens = (await highlightDiff(diff, 'a.ts'))!;
    expect([...tokens.old.keys()]).toEqual([1, 2, 3, 20]);
    expect([...tokens.new.keys()]).toEqual([1, 2, 3, 20, 21]);
    expect(text(tokens.old.get(2)!)).toBe("const b = 'old';");
    expect(text(tokens.new.get(2)!)).toBe("const b = 'new';");
    expect(text(tokens.new.get(21)!)).toBe('// extra');
    expect(tokens.new.get(2)!.some((token) => token.color.toLowerCase() === '#98c379')).toBe(true);
  });

  it('null for an unknown language and for an empty diff', async () => {
    expect(await highlightDiff(diff, 'a.xyz')).toBeNull();
    expect(await highlightDiff(parseDiff(''), 'a.ts')).toBeNull();
  });
});
