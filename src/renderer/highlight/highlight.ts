// Syntax colors: Shiki with the One Dark Pro theme. Uses the JavaScript regex engine; no WebAssembly
// is loaded and nothing goes over the network. The theme and languages ship in the bundle.
import type { HighlighterCore, LanguageInput } from 'shiki/core';
import type { ParsedDiff } from '../../git/diffParse';
import { LOADERS, languageOf } from './languages';

export interface Token {
  text: string;
  color: string;
}

/** Text longer than this isn't highlighted: it's shown plain. */
export const MAX_HIGHLIGHT_CHARS = 200_000;
/**
 * If any line is longer than this, the text isn't highlighted. On minified files Shiki keeps the
 * page's main thread busy for seconds, and the terminals run on that thread too.
 */
export const MAX_LINE_CHARS = 2000;

export const THEME = 'one-dark-pro';
const FOREGROUND = '#abb2bf';

let highlighter: Promise<HighlighterCore> | null = null;
const loading = new Map<string, Promise<void>>();

export function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/one-dark-pro.mjs'),
    ]);
    return createHighlighterCore({ themes: [theme.default], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) });
  })();
  return highlighter;
}

export function loadLanguage(core: HighlighterCore, id: string): Promise<void> {
  let pending = loading.get(id);
  if (!pending) {
    pending = LOADERS[id]!().then((module) => core.loadLanguage(module.default as LanguageInput));
    loading.set(id, pending);
  }
  return pending;
}

/**
 * Splits text into colored tokens line by line. Returns `null` if the language is unknown, the
 * text is too long or highlighting fails; the caller shows plain text. Never throws.
 */
export async function highlightLines(text: string, path: string): Promise<Token[][] | null> {
  const language = languageOf(path);
  if (!language || !LOADERS[language.id] || text.length > MAX_HIGHLIGHT_CHARS) return null;
  if (text.split('\n').some((line) => line.length > MAX_LINE_CHARS)) return null;
  try {
    const core = await getHighlighter();
    await loadLanguage(core, language.id);
    // Second safeguard: if it gets stuck on a single line, Shiki gives up after half a second.
    const lines = core.codeToTokensBase(text, { lang: language.id, theme: THEME, tokenizeMaxLineLength: MAX_LINE_CHARS, tokenizeTimeLimit: 500 });
    return lines.map((line) => line.filter((token) => token.content !== '').map((token) => ({ text: token.content, color: token.color ?? FOREGROUND })));
  } catch {
    return null;
  }
}

/** Colors for both sides of a diff: line number → tokens. */
export interface DiffTokens {
  old: Map<number, Token[]>;
  new: Map<number, Token[]>;
}

/**
 * Highlights the lines in a diff. Each hunk's old and new versions are read separately, each as
 * a whole piece of code on its own. `null` if the language is unknown or the diff is empty.
 */
export async function highlightDiff(diff: ParsedDiff, path: string): Promise<DiffTokens | null> {
  if (diff.hunks.length === 0 || !languageOf(path)) return null;
  const tokens: DiffTokens = { old: new Map(), new: new Map() };
  let budget = MAX_HIGHLIGHT_CHARS;
  for (const hunk of diff.hunks) {
    const sides = [
      { into: tokens.old, lines: hunk.lines.flatMap((line) => (line.kind === 'add' ? [] : [{ no: line.oldNo, text: line.text }])) },
      { into: tokens.new, lines: hunk.lines.flatMap((line) => (line.kind === 'del' ? [] : [{ no: line.newNo, text: line.text }])) },
    ];
    for (const side of sides) {
      if (side.lines.length === 0) continue;
      const text = side.lines.map((line) => line.text).join('\n');
      budget -= text.length;
      // The rest of a very long diff is shown plain.
      if (budget < 0) return tokens;
      const lines = await highlightLines(text, path);
      if (!lines) return null;
      side.lines.forEach((line, index) => {
        const parts = lines[index];
        if (parts) side.into.set(line.no, parts);
      });
    }
  }
  return tokens;
}
