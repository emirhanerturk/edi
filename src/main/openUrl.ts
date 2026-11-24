import { shell } from 'electron';
import type { OpResult } from '../shared/api.js';

const NOT_WEB = { ok: false, error: 'Only web links can be opened' } as const;
const MAX_URL = 2048;

/**
 * Opens a link from the terminal in the default browser. Only http and https: `file:`,
 * `javascript:` or an app's own scheme (`vscode://`) could run something other than the browser.
 */
export async function openUrl(url: unknown, open: (url: string) => Promise<void> = (u) => shell.openExternal(u)): Promise<OpResult> {
  if (typeof url !== 'string' || url.length > MAX_URL) return NOT_WEB;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NOT_WEB;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '') return NOT_WEB;
  try {
    await open(parsed.href);
    return { ok: true, message: 'Opened in the browser' };
  } catch {
    return { ok: false, error: 'Could not open the link' };
  }
}
