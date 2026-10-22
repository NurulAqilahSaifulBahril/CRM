const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { startServer, setUserDataDir } = require('../serve.cjs');

const HOST = '127.0.0.1';
const PORT = 8935;
const ENTRY = 'case-hub-api.html';

let mainWindow = null;
let httpServer = null;

// The Postgres token bundled with the app lives in the install directory, which an update wipes
// and replaces. So on first run it's copied into Electron's per-user data folder instead, and
// serve.cjs is told to prefer that copy. Rotating the token later just means opening that folder
// (via the menu item below) and editing the .env.local file in Notepad — no rebuild, no reinstall.
function seedUserConfig() {
  const userDataDir = app.getPath('userData');
  const seedTarget = path.join(userDataDir, '.env.local');
  if (!fs.existsSync(seedTarget)) {
    const bundled = path.join(__dirname, '..', '.env.local');
    if (fs.existsSync(bundled)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.copyFileSync(bundled, seedTarget);
    }
  }
  setUserDataDir(userDataDir);
  return userDataDir;
}

function isPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function waitForServer(host, port, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await isPortOpen(host, port, 500)) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`Timed out waiting for ${host}:${port}`));
      setTimeout(tick, 300);
    };
    tick().catch(reject);
  });
}

// Only binds the port if nothing is already listening on it. Without this guard, launching a
// second copy of the app — or having a leftover dev server on the same port — crashes the whole
// app with EADDRINUSE instead of just reusing what's already there.
async function ensureServer() {
  if (httpServer) return;
  if (await isPortOpen(HOST, PORT, 300)) return;
  httpServer = await startServer({ entry: ENTRY, port: PORT });
}

async function createWindow() {
  await ensureServer();
  await waitForServer(HOST, PORT);

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#ffffff',
    title: 'Eternalgy CRM',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  await mainWindow.loadURL(`http://${HOST}:${PORT}/`);
  checkForUpdates();
}

function buildMenu(userDataDir) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Settings Folder (update DB token here)', click: () => shell.openPath(userDataDir) },
        { label: 'Check for Updates', click: () => checkForUpdates() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Fully automatic and silent, matching how the Installation System's updater installs on the
// user's next restart with no wizard: download in the background, then let electron-updater's
// default autoInstallOnAppQuit apply it the next time the app closes. No prompts either way.
//
// Silent used to mean invisible: the events below only reached the terminal, which nobody running
// the installed app ever sees. So the state is mirrored into this object and pushed to the window,
// where the dashboard shows the running version and whether an update is waiting. Nothing about
// the install behaviour changed — this only makes it visible, plus two optional buttons.
autoUpdater.autoDownload = true;

const updateState = {
  version: app.getVersion(),
  // 'disabled' until the first check, because an unpackaged dev run has no feed to check against.
  status: 'idle',   // idle | checking | current | downloading | downloaded | error | disabled
  newVersion: null,
  percent: 0,
  error: null,
  checkedAt: null,  // ISO string, stamped when a check reaches a conclusion
};

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:state', updateState);
  }
}
const stamp = () => new Date().toISOString();

autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
autoUpdater.on('update-not-available', () => setUpdateState({ status: 'current', newVersion: null, checkedAt: stamp() }));
// autoDownload means "available" is immediately followed by the download starting, so there is no
// separate "available" state worth showing — it would flash past.
autoUpdater.on('update-available', (info) => setUpdateState({ status: 'downloading', newVersion: info.version, percent: 0, checkedAt: stamp() }));
autoUpdater.on('download-progress', (p) => setUpdateState({ status: 'downloading', percent: Math.round(p.percent || 0) }));
autoUpdater.on('update-downloaded', (info) => {
  console.log(`Update ${info.version} downloaded — will install next time the app restarts.`);
  setUpdateState({ status: 'downloaded', newVersion: info.version, percent: 100, checkedAt: stamp() });
});
autoUpdater.on('error', (e) => {
  console.error('Auto-update error:', e && e.message);
  setUpdateState({ status: 'error', error: (e && e.message) || String(e), checkedAt: stamp() });
});

function checkForUpdates() {
  if (!app.isPackaged) return setUpdateState({ status: 'disabled' }); // dev runs have no update feed to check
  setUpdateState({ status: 'checking', error: null });
  autoUpdater.checkForUpdates().catch((e) => {
    console.error('Update check failed:', e && e.message);
    setUpdateState({ status: 'error', error: (e && e.message) || String(e), checkedAt: stamp() });
  });
}

// A mounting dashboard needs the current state, not just future changes — events already fired
// before the page loaded would otherwise leave it stuck on "not checked yet".
ipcMain.handle('updater:get-state', () => updateState);
ipcMain.handle('updater:check', () => { checkForUpdates(); return updateState; });
// Same silent install autoInstallOnAppQuit would do on the next quit, just now instead of later,
// and relaunching afterwards so the user lands back where they were.
ipcMain.handle('updater:restart', () => {
  if (updateState.status !== 'downloaded') return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
});

async function boot() {
  const userDataDir = seedUserConfig();
  buildMenu(userDataDir);
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('CRM failed to start', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

app.whenReady().then(boot).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    boot().catch((error) => {
      console.error(error);
      app.exit(1);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});
