import { describe, expect, it } from 'vitest';
import { MAX_HIGHLIGHT_CHARS, highlightLines } from '../../src/renderer/highlight/highlight';

const text = (tokens: { text: string }[]) => tokens.map((token) => token.text).join('');

describe('highlightLines', () => {
  it('satır başına bir belirteç listesi döner; metin aynen korunur', async () => {
    const lines = await highlightLines('const a = 1;\n// x', 'a.ts');
    expect(lines).not.toBeNull();
    expect(lines!.map(text)).toEqual(['const a = 1;', '// x']);
  });

  it('anahtar sözcük ile yorum farklı renktedir', async () => {
    const lines = (await highlightLines('const a = 1;\n// x', 'a.ts'))!;
    const keyword = lines[0]!.find((token) => token.text.includes('const'))!;
    const comment = lines[1]!.find((token) => token.text.includes('x'))!;
    expect(keyword.color).toMatch(/^#[0-9a-f]{6}/i);
    expect(comment.color).toMatch(/^#[0-9a-f]{6}/i);
    expect(keyword.color.toLowerCase()).not.toBe(comment.color.toLowerCase());
  });

  it('One Dark Pro renklerini kullanır', async () => {
    const lines = (await highlightLines("const s = 'x';", 'a.ts'))!;
    const colors = lines[0]!.map((token) => token.color.toLowerCase());
    expect(colors).toContain('#c678dd'); // anahtar sözcük
    expect(colors).toContain('#98c379'); // metin
  });

  it('tsx ve json gibi başka dilleri de yükler', async () => {
    expect((await highlightLines('const a = <View />;', 'a.tsx'))!.map(text)).toEqual(['const a = <View />;']);
    expect((await highlightLines('{ "a": 1 }', 'a.json'))!.map(text)).toEqual(['{ "a": 1 }']);
  });

  it('bilinmeyen dilde null', async () => {
    expect(await highlightLines('x', 'a.xyz')).toBeNull();
    expect(await highlightLines('x', 'LICENSE')).toBeNull();
  });

  it('boş metin tek boş satırdır', async () => {
    expect(await highlightLines('', 'a.ts')).toEqual([[]]);
  });

  it('boş satırlar ve CRLF satır sayısını bozmaz', async () => {
    const lines = (await highlightLines('a\r\n\r\nb\n', 'a.ts'))!;
    expect(lines.map(text)).toEqual(['a', '', 'b', '']);
  });

  it('çok uzun metni renklendirmez', async () => {
    expect(await highlightLines('a'.repeat(MAX_HIGHLIGHT_CHARS + 1), 'a.ts')).toBeNull();
    expect(MAX_HIGHLIGHT_CHARS).toBe(200_000);
  });
});
