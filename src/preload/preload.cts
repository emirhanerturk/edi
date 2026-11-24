// Sayfaya açılan tek kapı. Burada yalnız dar, adı belli işlemler bulunur; sayfa serbest biçimli
// komut ya da kanal adı gönderemez.
import { contextBridge, ipcRenderer } from 'electron';
import type { EdiApi, EdiEvents } from '../shared/api.js' with { 'resolution-mode': 'import' };

const EVENTS: ReadonlySet<string> = new Set<keyof EdiEvents>(['workspace', 'recent']);

const api: EdiApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: (dir) => ipcRenderer.invoke('folder:open', dir),
  rescan: () => ipcRenderer.invoke('workspace:rescan'),
  on: (channel, listener) => {
    if (!EVENTS.has(channel)) return () => undefined;
    const wrapped = (_event: unknown, ...args: unknown[]) => (listener as (...a: unknown[]) => void)(...args);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('edi', api);
