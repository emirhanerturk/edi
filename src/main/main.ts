import path from 'node:path';
import { BrowserWindow, Menu, app } from 'electron';

// Testler ve geliştirme, kullanıcının gerçek ayar klasörüne dokunmasın diye ayrı bir klasör verebilir.
if (process.env.EDI_USER_DATA) app.setPath('userData', process.env.EDI_USER_DATA);

const here = import.meta.dirname;
const devUrl = process.env.VITE_DEV_SERVER_URL;
/** Uçtan uca testlerde pencere ekrana gelmez. */
const hidden = process.env.EDI_HIDDEN === '1';

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
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
      // Gizli pencerede de (testler) çizim ve zamanlayıcılar normal hızda çalışsın.
      backgroundThrottling: !hidden,
    },
  });

  // Sayfa yalnız uygulamanın kendisidir: yeni pencere açamaz, başka adrese gidemez.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (!hidden) win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(here, '../renderer/index.html'));
}

app.whenReady().then(() => {
  // Varsayılan menüdeki Cmd+W pencereyi, Cmd+R sayfayı (ve terminalleri) kapatır; ikisi de istenmiyor.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'toggleDevTools' }] },
    ]),
  );
  createWindow();
});

app.on('window-all-closed', () => app.quit());
