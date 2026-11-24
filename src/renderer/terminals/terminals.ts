// The tabs' xterm instances. Kept outside React: a terminal carries too much state (history,
// cursor, selection) to be torn down and rebuilt on rerenders.
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import type { NewTerminal, TerminalCreated } from '../../shared/api';
import { edi } from '../bridge';
import { linkActivator } from './links';

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

/** The area terminals are drawn into. When the area changes, the active terminal is resized. */
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

/** Opens a new terminal and the shell behind it. */
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
    // Let Option characters (@ # { } [ ] | \ ~) be typed on a Turkish keyboard.
    macOptionIsMeta: false,
    // Option+click opens a link; don't send the shell the arrow keys that move the cursor there.
    altClickMovesCursor: false,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // http(s) links are shown underlined; Option+click opens them in the default browser.
  term.loadAddon(new WebLinksAddon(linkActivator((url) => void edi.openUrl(url))));
  term.open(host);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // Without WebGL, carry on with DOM rendering.
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
    // Shift+Enter: new line in Claude Code (ESC + CR).
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

/** Brings the tab to the front, resizes it and gives it keyboard focus. */
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

/** Called when the terminal title changes (Claude Code writes its state into the title). */
export function onTerminalTitle(id: number, listener: (title: string) => void): void {
  entries.get(id)?.term.onTitleChange(listener);
}
