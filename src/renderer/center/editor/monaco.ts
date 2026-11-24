// Monaco, loaded only when a file view opens. Colors come from Shiki with the same grammars and One
// Dark Pro theme as the diff view; Monaco's own languages and language services aren't bundled.
import { shikiToMonaco } from '@shikijs/monaco';
import type { HighlighterCore } from 'shiki/core';
import * as monaco from 'monaco-esm/editor/editor.api.js';
import EditorWorker from 'monaco-esm/editor/editor.worker.js?worker';
import { MAX_LINE_CHARS, THEME, getHighlighter, loadLanguage } from '../../highlight/highlight';
import { LOADERS, languageOf } from '../../highlight/languages';
import type { EditDoc } from '../editSession';
import './contributions.js';

(globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

type Monaco = typeof monaco;
type ShikiArg = Parameters<typeof shikiToMonaco>[0];
type MonacoArg = Parameters<typeof shikiToMonaco>[1];

const bridged = new Map<string, Promise<void>>();
let themed = false;

/**
 * Hands one Shiki language to Monaco. `shikiToMonaco` sets up the theme and the token providers of
 * the languages it is given, and wraps `setTheme`/`create` while doing so; the wraps are undone each
 * time, since the theme never changes.
 */
function bridge(core: HighlighterCore, id: string | null): Promise<void> {
  const key = id ?? '';
  let pending = bridged.get(key);
  if (!pending) {
    pending = (async () => {
      if (id) {
        await loadLanguage(core, id);
        monaco.languages.register({ id });
      }
      if (id === null && themed) return;
      const { setTheme, create } = monaco.editor;
      const only: ShikiArg = {
        getLoadedThemes: () => [THEME],
        getTheme: (name: string) => core.getTheme(name),
        setTheme: (name: string) => core.setTheme(name),
        getLoadedLanguages: () => (id ? [id] : []),
        getLanguage: (name: string) => core.getLanguage(name),
      } as unknown as ShikiArg;
      shikiToMonaco(only, monaco as unknown as MonacoArg, { tokenizeMaxLineLength: MAX_LINE_CHARS, tokenizeTimeLimit: 500 });
      monaco.editor.setTheme = setTheme;
      monaco.editor.create = create;
      themed = true;
    })();
    bridged.set(key, pending);
  }
  return pending;
}

export interface EditorDocument extends EditDoc {
  model: monaco.editor.ITextModel;
  dispose(): void;
}

/** A Monaco model for an open file; it keeps the text and undo history while its tab is open. */
export async function createDocument(text: string, path: string): Promise<EditorDocument> {
  const core = await getHighlighter();
  const language = languageOf(path);
  const id = language && LOADERS[language.id] ? language.id : null;
  await bridge(core, null);
  if (id) await bridge(core, id).catch(() => undefined);
  const model = monaco.editor.createModel(text, id && monaco.languages.getLanguages().some((l) => l.id === id) ? id : 'plaintext');
  return {
    model,
    getValue: () => model.getValue(),
    version: () => model.getAlternativeVersionId(),
    replace(next) {
      model.pushStackElement();
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null);
      model.pushStackElement();
    },
    onChange(listener) {
      const subscription = model.onDidChangeContent(listener);
      return () => subscription.dispose();
    },
    dispose: () => model.dispose(),
  };
}

export interface EditorHandle {
  dispose(): void;
  focus(): void;
}

/**
 * A code editor on `doc` inside `element`. ⌘S calls `onSave`. `viewState` restores the scroll position
 * and cursor from the last time this file was shown; `onLeave` gets it back when the editor goes away.
 */
export function mountEditor(
  element: HTMLElement,
  doc: EditorDocument,
  options: { onSave(): void; viewState: unknown; onLeave(viewState: unknown): void },
): EditorHandle {
  const editor = monaco.editor.create(element, {
    model: doc.model,
    theme: THEME,
    automaticLayout: true,
    fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
    fontSize: 12,
    lineHeight: 22,
    fontLigatures: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    tabSize: 2,
    detectIndentation: true,
    padding: { top: 10, bottom: 10 },
    lineNumbersMinChars: 4,
    stickyScroll: { enabled: false },
    contextmenu: true,
    fixedOverflowWidgets: true,
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => options.onSave());
  if (options.viewState) editor.restoreViewState(options.viewState as monaco.editor.ICodeEditorViewState);
  return {
    focus: () => editor.focus(),
    dispose() {
      options.onLeave(editor.saveViewState());
      editor.dispose();
    },
  };
}

export type { Monaco };
