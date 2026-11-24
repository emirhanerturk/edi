// Sekmelerin xterm örnekleri. React'in dışında tutulur: terminal, yeniden çizimlerde
// yok edilip yeniden kurulamayacak kadar durum taşır (geçmiş, imleç, seçim).
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import type { NewTerminal, TerminalCreated } from '../../shared/api';
import { edi } from '../bridge';

interface Entry {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
}

const THEME = {
  background: '#282c34',
  foreground: '#abb2bf',
  cursor: '#d7dae0',
  cursorAccent: '#282c34',
  selectionBackground: '#3e4451',
  black: '#21252b',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const entries = new Map<number, Entry>();
let container: HTMLElement | null = null;
let activeId: number | null = null;
let observer: ResizeObserver | null = null;

/** Terminallerin çizileceği alan. Alan değişince etkin terminal yeniden boyutlanır. */
export function setContainer(element: HTMLElement | null): void {
  observer?.disconnect();
  observer = null;
  container = element;
  if (!element) return;
  for (const entry of entries.values()) element.append(entry.host);
  observer = new ResizeObserver(() => fitActive());
  observer.observe(element);
}

function fitActive(): void {
  if (activeId === null) return;
  const entry = entries.get(activeId);
  if (!entry || entry.host.clientWidth === 0 || entry.host.clientHeight === 0) return;
  entry.fit.fit();
  edi.pty.resize(activeId, entry.term.cols, entry.term.rows);
}

/** Yeni bir terminal ve arkasındaki kabuğu açar. */
export async function openTerminal(opts: Omit<NewTerminal, 'cols' | 'rows'>): Promise<TerminalCreated> {
  if (!container) throw new Error('Terminal area is not ready');
  const host = document.createElement('div');
  host.className = 'term-host active';
  for (const entry of entries.values()) entry.host.classList.remove('active');
  container.append(host);

  const term = new Terminal({
    fontFamily: "'SF Mono', Menlo, Monaco, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    // Türkçe klavyede Option'lı karakterler (@ # { } [ ] | \ ~) yazılabilsin.
    macOptionIsMeta: false,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // WebGL yoksa DOM çizimiyle devam.
  }
  if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();

  let created: TerminalCreated;
  try {
    created = await edi.pty.create({ ...opts, cols: term.cols, rows: term.rows });
  } catch (error) {
    term.dispose();
    host.remove();
    throw error;
  }
  const { id } = created;
  entries.set(id, { term, fit, host });

  term.onData((data) => edi.pty.write(id, data));
  term.attachCustomKeyEventHandler((event) => {
    // Shift+Enter: Claude Code'da yeni satır (ESC + CR).
    if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey && !event.metaKey) {
      event.preventDefault();
      edi.pty.write(id, '\x1b\r');
      return false;
    }
    return true;
  });
  showTerminal(id);
  return created;
}

/** Sekmeyi öne getirir, boyutlandırır ve klavyeyi ona verir. */
export function showTerminal(id: number | null): void {
  activeId = id;
  for (const [key, entry] of entries) entry.host.classList.toggle('active', key === id);
  if (id === null) return;
  fitActive();
  entries.get(id)?.term.focus();
}

export function writeTerminal(id: number, data: string): void {
  entries.get(id)?.term.write(data);
}

export function disposeTerminal(id: number): void {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  entry.term.dispose();
  entry.host.remove();
  if (activeId === id) activeId = null;
}

export function disposeAllTerminals(): void {
  for (const id of [...entries.keys()]) disposeTerminal(id);
}

/** Terminal başlığı değişince çağrılır (Claude Code durumunu başlığa yazar). */
export function onTerminalTitle(id: number, listener: (title: string) => void): void {
  entries.get(id)?.term.onTitleChange(listener);
}
