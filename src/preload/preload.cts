// The only door into the page. It holds only narrow, named operations; the page can't send
// free-form commands or channel names.
import { contextBridge, ipcRenderer } from 'electron';
import type { EdiApi, EdiEvents } from '../shared/api.js' with { 'resolution-mode': 'import' };

const EVENTS: ReadonlySet<string> = new Set<keyof EdiEvents>(['workspace', 'recent', 'pty:data', 'pty:exit', 'tabs', 'servers', 'usage']);

const api: EdiApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: (dir) => ipcRenderer.invoke('folder:open', dir),
  rescan: () => ipcRenderer.invoke('workspace:rescan'),
  setLayout: (patch) => ipcRenderer.send('layout:set', patch),
  git: (repoPath, op) => ipcRenderer.invoke('git:run', repoPath, op),
  fetchAll: () => ipcRenderer.invoke('git:fetchAll'),
  branches: (repoPath) => ipcRenderer.invoke('git:branches', repoPath),
  unpushed: (repoPath) => ipcRenderer.invoke('git:unpushed', repoPath),
  confirmUndo: (subject) => ipcRenderer.invoke('git:confirmUndo', subject),
  diff: (repoPath, filePath) => ipcRenderer.invoke('view:diff', repoPath, filePath),
  readFile: (repoPath, filePath) => ipcRenderer.invoke('view:read', repoPath, filePath),
  writeFile: (repoPath, filePath, text, expected) => ipcRenderer.invoke('view:write', repoPath, filePath, text, expected),
  createEntry: (repoPath, path, kind) => ipcRenderer.invoke('files:create', repoPath, path, kind),
  renameEntry: (repoPath, path, name, unsaved) => ipcRenderer.invoke('files:rename', repoPath, path, name, unsaved),
  trashEntry: (repoPath, path, unsaved) => ipcRenderer.invoke('files:trash', repoPath, path, unsaved),
  revealEntry: (repoPath, path) => ipcRenderer.invoke('files:reveal', repoPath, path),
  filesMenu: (kind) => ipcRenderer.invoke('files:menu', kind),
  headText: (repoPath, filePath) => ipcRenderer.invoke('view:headText', repoPath, filePath),
  blame: (repoPath, filePath, text) => ipcRenderer.invoke('view:blame', repoPath, filePath, text),
  setUnsaved: (count) => ipcRenderer.send('edits:unsaved', count),
  confirmDiscard: (name) => ipcRenderer.invoke('edits:confirmDiscard', name),
  listFiles: (repoPath) => ipcRenderer.invoke('view:list', repoPath),
  listDir: (repoPath, dirPath) => ipcRenderer.invoke('view:listDir', repoPath, dirPath),
  claudeUsage: () => ipcRenderer.invoke('usage:get'),
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
