// ATILACAK DENEME
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['pty:data', 'pty:exit', 'pty:procs', 'repos'];

contextBridge.exposeInMainWorld('edi', {
  config: () => ipcRenderer.invoke('config'),
  createPty: (opts) => ipcRenderer.invoke('pty:create', opts),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  on: (channel, listener) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_event, ...args) => listener(...args));
  },
  reportSmoke: (result) => ipcRenderer.send('smoke:result', result),
});
