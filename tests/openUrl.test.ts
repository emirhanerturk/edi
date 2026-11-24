import { describe, expect, it, vi } from 'vitest';
import { openUrl } from '../src/main/openUrl.js';

describe('openUrl', () => {
  it('http ve https adreslerini tarayıcıda açar', async () => {
    const open = vi.fn(async () => undefined);
    for (const url of ['http://localhost:5173/', 'https://example.com/a?b=c#d', 'http://127.0.0.1:3000']) {
      expect(await openUrl(url, open), url).toEqual({ ok: true, message: 'Opened in the browser' });
    }
    expect(open.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['http://localhost:5173/', 'https://example.com/a?b=c#d', 'http://127.0.0.1:3000/']);
  });

  it('başka şemaları, bozuk ya da çok uzun adresleri açmaz', async () => {
    const open = vi.fn(async () => undefined);
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://x', 'ssh://host', 'mailto:a@b.c', 'localhost:5173', 'http://', '', `https://x.dev/${'a'.repeat(2100)}`, null, 7]) {
      expect(await openUrl(url, open), String(url)).toEqual({ ok: false, error: 'Only web links can be opened' });
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('tarayıcı açılamazsa hata döner', async () => {
    expect(await openUrl('https://example.com', async () => Promise.reject(new Error('no browser')))).toEqual({ ok: false, error: 'Could not open the link' });
  });
});
