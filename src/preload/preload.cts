// Sayfaya açılan tek kapı. Burada yalnız dar, adı belli işlemler bulunur; sayfa serbest biçimli
// komut ya da kanal adı gönderemez.
import { contextBridge, ipcRenderer } from 'electron';
import type { EdiApi, EdiEvents } from '../shared/api.js' with { 'resolution-mode': 'import' };

const EVENTS: ReadonlySet<string> = new Set<keyof EdiEvents>(['workspace', 'recent', 'pty:data', 'pty:exit', 'tabs', 'servers']);

const api: EdiApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: (dir) => ipcRenderer.invoke('folder:open', dir),
  rescan: () => ipcRenderer.invoke('workspace:rescan'),
  setLayout: (patch) => ipcRenderer.send('layout:set', patch),
  git: (repoPath, op) => ipcRenderer.invoke('git:run', repoPath, op),
  fetchAll: () => ipcRenderer.invoke('git:fetchAll'),
  branches: (repoPath) => ipcRenderer.invoke('git:branches', repoPath),
  diff: (repoPath, filePath) => ipcRenderer.invoke('view:diff', repoPath, filePath),
  readFile: (repoPath, filePath) => ipcRenderer.invoke('view:read', repoPath, filePath),
  listFiles: (repoPath) => ipcRenderer.invoke('view:list', repoPath),
  listDir: (repoPath, dirPath) => ipcRenderer.invoke('view:listDir', repoPath, dirPath),
  openInZed: (repoPath, filePath) => ipcRenderer.invoke('view:openInZed', repoPath, filePath),
  openUrl: (url) => ipcRenderer.invoke('shell:openUrl', url),
  log: (repoPath, count) => ipcRenderer.invoke('history:log', repoPath, count),
  commit: (repoPath, oid) => ipcRenderer.invoke('history:commit', repoPath, oid),
  pty: {
    create: (o) => ipcRenderer.invoke('pty:create', o),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    close: (id) => ipcRenderer.send('pty:close', id),
  },
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
