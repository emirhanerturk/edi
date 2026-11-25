import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, Menu, app, powerMonitor, protocol, screen } from 'electron';
import { folderArg } from './args.js';
import { AppCore } from './ipc.js';
import { setLoginEnv } from '../childEnv.js';
import { readLoginEnv } from './loginEnv.js';
import { MEDIA_SCHEME } from '../shared/media.js';

// Tests and development can pass a separate folder so they don't touch the user's real settings folder.
// The unpackaged development build uses a separate folder too, so it doesn't hit the installed edi's
// single-instance lock and quit.
if (process.env.EDI_USER_DATA) app.setPath('userData', process.env.EDI_USER_DATA);
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'edi-dev'));

// Single instance: `edi <folder>` starts a new instance; it can't get the lock, so it hands the folder
// to the running one and quits. The open window switches to that folder (asking first if a terminal is running).
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

// The scheme for image and video previews, with stream and fetch support so videos can seek.
// It must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

const here = import.meta.dirname;
const devUrl = process.env.VITE_DEV_SERVER_URL;
/** In end-to-end tests the window is never shown. */
const hidden = process.env.EDI_HIDDEN === '1';

let win: BrowserWindow | null = null;
let core: AppCore;
/** A folder handed over by `edi <folder>` before the app was ready: the latest one. */
let handedOver: string | undefined;

/** The saved position is used only if it is still within a display (the display may have been disconnected). */
function savedBounds(): { x: number; y: number; width: number; height: number } | undefined {
  const saved = core.persisted.window;
  if (!saved) return undefined;
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(saved.x + saved.width, workArea.x + workArea.width) - Math.max(saved.x, workArea.x);
    const overlapY = Math.min(saved.y + saved.height, workArea.y + workArea.height) - Math.max(saved.y, workArea.y);
    return overlapX > 120 && overlapY > 80;
  });
  return visible ? saved : undefined;
}

let quitting: 'no' | 'asking' | 'yes' = 'no';
/** macOS is logging out, restarting or shutting down. */
let sessionEnding = false;

/** Keeps the window's position, and closes the terminals and timers. */
function saveWindowAndDispose(): void {
  if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) {
    const bounds = win.getBounds();
    core.update((state) => ({ ...state, window: bounds }));
  }
  core.dispose();
}

/** The only way out: asks if a terminal is running, writes the final state to disk, then quits. */
async function requestQuit(): Promise<void> {
  if (quitting !== 'no') return;
  quitting = 'asking';
  try {
    if (!(await core.confirmBusy('quit'))) {
      quitting = 'no';
      return;
    }
    saveWindowAndDispose();
    await core.flush();
  } catch {
    // The user must be able to quit even if the prompt or the save fails.
  }
  quitting = 'yes';
  app.quit();
}

/**
 * The session is ending and nothing needs asking: quit without deferring. macOS takes a deferred quit
 * as the app cancelling the logout, so the state is written before returning instead of awaited.
 */
function quitForSessionEnd(): void {
  try {
    saveWindowAndDispose();
    core.saveNow();
  } catch {
    // The session ends either way.
  }
  quitting = 'yes';
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...savedBounds(),
    // Minimum widths of the three panels: 320 + 360 + 300.
    minWidth: 980,
    minHeight: 560,
    show: false,
    title: 'edi',
    backgroundColor: '#282C34',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(here, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep painting and timers at normal speed in a hidden window too (tests).
      backgroundThrottling: !hidden,
    },
  });

  // The page is only the app itself: it can't open new windows or navigate elsewhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (!hidden) win.once('ready-to-show', () => win?.show());
  // Closing the window quits the app; if a terminal is running, it asks first.
  win.on('close', (event) => {
    if (quitting === 'yes') return;
    event.preventDefault();
    void requestQuit();
  });
  // Back at the window: the repos not fetched for a minute are fetched now.
  win.on('focus', () => void core.autoFetch.focus());
  win.on('closed', () => {
    win = null;
  });

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(here, '../renderer/index.html'));
}

// The packaged app launched from the Dock doesn't get the shell settings (PATH): the login shell's
// environment is read once. It doesn't delay startup; it is ready long before the first commit that runs hooks.
// git and the terminals started after it arrives get it (each tab still runs its own login shell); the
// app's own environment is left alone. A second instance that will hand over the folder and quit doesn't run the shell.
if (app.isPackaged && primary) {
  const shell = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
  void readLoginEnv(shell).then(setLoginEnv);
}

app.on('second-instance', (_event, argv) => {
  // If the terminal stays in front, the "Switch folders?" prompt stays hidden behind it: bring the app forward.
  // The window running hidden in tests isn't made visible.
  if (win && !win.isDestroyed() && !hidden) {
    if (win.isMinimized()) win.restore();
    win.show();
    app.focus({ steal: true });
    win.focus();
  }
  const dir = folderArg(argv);
  if (dir === undefined) return;
  // Before the app is ready the folder is kept, and opened at startup in place of the usual one.
  if (core) void core.openFolder(dir);
  else handedOver = dir;
});

app.whenReady().then(async () => {
  if (!primary) return;
  core = await AppCore.create(path.join(app.getPath('userData'), 'state.json'), () => win);
  // In the default menu, Cmd+W closes the window and Cmd+R reloads the page (closing the terminals); neither is wanted.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          {
            label: 'Layout',
            submenu: [
              { label: 'Terminals on the Left', type: 'radio', checked: core.persisted.layout.terminals === 'left', click: () => core.setTerminalSide('left') },
              { label: 'Terminals on the Right', type: 'radio', checked: core.persisted.layout.terminals === 'right', click: () => core.setTerminalSide('right') },
            ],
          },
          { type: 'separator' },
          { label: 'Fetch Automatically', type: 'checkbox', checked: core.persisted.autoFetch, click: (item) => core.setAutoFetch(item.checked) },
          { label: 'Keep Mac Awake', type: 'checkbox', checked: core.persisted.keepAwake, click: (item) => core.setKeepAwake(item.checked) },
          { type: 'separator' },
          { role: 'toggleDevTools' },
        ],
      },
    ]),
  );
  // Sent before macOS asks the apps to quit for a logout, restart or shutdown.
  powerMonitor.on('shutdown', () => {
    sessionEnding = true;
  });
  core.register();
  // The folder is opened before the window: the repos are ready when the page asks for the initial state.
  await core.openInitial(handedOver ?? folderArg(process.argv) ?? process.env.EDI_OPEN_DIR);
  createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (quitting === 'yes') return;
  // Ending the session with nothing to ask about: let it go through. With a busy terminal, unsaved
  // files or a git operation running, edi asks as on any quit, and macOS stops the logout meanwhile.
  if (sessionEnding && quitting === 'no' && core && !core.wouldAskToQuit()) {
    quitForSessionEnd();
    return;
  }
  event.preventDefault();
  void requestQuit();
});
