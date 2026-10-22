// The only channel between the page and the main process. contextIsolation is on and there is no
// nodeIntegration, so the renderer gets exactly these four functions and nothing else — no ipcRenderer,
// no require, no filesystem.
//
// Read-only apart from two explicit user actions (check now / restart to apply), both of which the
// user has to click. Nothing here can touch the database or the Postgres token.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('casehubUpdater', {
  // Current snapshot — used once on mount, since events only fire on change.
  getState: () => ipcRenderer.invoke('updater:get-state'),
  check: () => ipcRenderer.invoke('updater:check'),
  restartToInstall: () => ipcRenderer.invoke('updater:restart'),
  // Returns its own unsubscribe function, so a React effect can clean up on unmount.
  onState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('updater:state', handler);
    return () => ipcRenderer.removeListener('updater:state', handler);
  },
});
