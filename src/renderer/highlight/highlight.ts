// Sözdizimi renkleri: Shiki, One Dark Pro teması. JavaScript regex motoru kullanılır; WebAssembly
// yüklenmez, ağa çıkılmaz. Tema ve diller paketin içindedir.
import type { HighlighterCore, LanguageInput } from 'shiki/core';
import { LOADERS, languageOf } from './languages';

export interface Token {
  text: string;
  color: string;
}

/** Bundan uzun metin renklendirilmez: düz gösterilir. */
export const MAX_HIGHLIGHT_CHARS = 200_000;

const THEME = 'one-dark-pro';
const FOREGROUND = '#abb2bf';

let highlighter: Promise<HighlighterCore> | null = null;
const loading = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
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

function loadLanguage(core: HighlighterCore, id: string): Promise<void> {
  let pending = loading.get(id);
  if (!pending) {
    pending = LOADERS[id]!().then((module) => core.loadLanguage(module.default as LanguageInput));
    loading.set(id, pending);
  }
  return pending;
}

/**
 * Metni satır satır renkli parçalara ayırır. Dil bilinmiyorsa, metin çok uzunsa ya da
 * renklendirme başarısız olursa `null` döner; çağıran düz metin gösterir. Hiç throw etmez.
 */
export async function highlightLines(text: string, path: string): Promise<Token[][] | null> {
  const language = languageOf(path);
  if (!language || !LOADERS[language.id] || text.length > MAX_HIGHLIGHT_CHARS) return null;
  try {
    const core = await getHighlighter();
    await loadLanguage(core, language.id);
    const lines = core.codeToTokensBase(text, { lang: language.id, theme: THEME });
    return lines.map((line) => line.filter((token) => token.content !== '').map((token) => ({ text: token.content, color: token.color ?? FOREGROUND })));
  } catch {
    return null;
  }
}
