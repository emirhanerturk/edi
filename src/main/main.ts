import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, Menu, app, screen } from 'electron';
import { folderArg } from './args.js';
import { AppCore } from './ipc.js';
import { mergeLoginEnv, readLoginEnv } from './loginEnv.js';

// Testler ve geliştirme, kullanıcının gerçek ayar klasörüne dokunmasın diye ayrı bir klasör verebilir.
// Paketsiz çalışan geliştirme kopyası da ayrı klasörü kullanır: kurulu edi'nin tek-kopya kilidine
// takılıp kapanmasın.
if (process.env.EDI_USER_DATA) app.setPath('userData', process.env.EDI_USER_DATA);
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'edi-dev'));

// Tek kopya: `edi <klasör>` yeni bir kopya başlatır; o kopya kilidi alamaz, klasörü açık olana
// devreder ve kapanır. Açık pencere o klasöre geçer (çalışan terminal varsa sorulur).
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

const here = import.meta.dirname;
const devUrl = process.env.VITE_DEV_SERVER_URL;
/** Uçtan uca testlerde pencere ekrana gelmez. */
const hidden = process.env.EDI_HIDDEN === '1';

let win: BrowserWindow | null = null;
let core: AppCore;

/** Kayıtlı konum hâlâ bir ekranın içindeyse kullanılır (ekran çıkarılmış olabilir). */
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

/** Çıkışın tek yolu: çalışan terminal varsa sorar, son durumu diske yazar, sonra çıkar. */
async function requestQuit(): Promise<void> {
  if (quitting !== 'no') return;
  quitting = 'asking';
  try {
    if (!(await core.confirmBusy('quit'))) {
      quitting = 'no';
      return;
    }
    if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) {
      const bounds = win.getBounds();
      core.update((state) => ({ ...state, window: bounds }));
    }
    core.dispose();
    await core.flush();
  } catch {
    // Soru ya da kayıt başarısız olsa da kullanıcı çıkabilmeli.
  }
  quitting = 'yes';
  app.quit();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...savedBounds(),
    // Üç panelin en küçük genişlikleri: 320 + 360 + 300.
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
      // Gizli pencerede de (testler) çizim ve zamanlayıcılar normal hızda çalışsın.
      backgroundThrottling: !hidden,
    },
  });

  // Sayfa yalnız uygulamanın kendisidir: yeni pencere açamaz, başka adrese gidemez.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (!hidden) win.once('ready-to-show', () => win?.show());
  // Pencereyi kapatmak uygulamadan çıkmaktır; çalışan terminal varsa önce sorulur.
  win.on('close', (event) => {
    if (quitting === 'yes') return;
    event.preventDefault();
    void requestQuit();
  });
  win.on('closed', () => {
    win = null;
  });

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(here, '../renderer/index.html'));
}

// Dock'tan açılan paketli uygulama kabuk ayarlarını (PATH) almaz: giriş kabuğunun ortamı bir
// kez okunur. Açılışı bekletmez; hook'ları çalıştıracak ilk commit'ten çok önce hazır olur.
// Ortam geldikten sonra açılan terminaller onu da devralır; her sekme yine kendi giriş kabuğunu
// çalıştırır. Klasörü devredip kapanacak ikinci kopya kabuğu çalıştırmaz.
if (app.isPackaged && primary) {
  const shell = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
  void readLoginEnv(shell).then((login) => {
    if (!login) return;
    // process.env'in kendisi güncellenir (yerine düz bir nesne konmaz).
    for (const [name, value] of Object.entries(mergeLoginEnv(process.env, login))) {
      if (value !== undefined) process.env[name] = value;
    }
  });
}

app.on('second-instance', (_event, argv) => {
  // Terminal önde kalırsa "Switch folders?" sorusu arkada görünmez kalır: uygulama öne alınır.
  // Testlerde gizli çalışan pencere görünür yapılmaz.
  if (win && !win.isDestroyed() && !hidden) {
    if (win.isMinimized()) win.restore();
    win.show();
    app.focus({ steal: true });
    win.focus();
  }
  const dir = folderArg(argv);
  if (dir !== undefined && core) void core.openFolder(dir);
});

app.whenReady().then(async () => {
  if (!primary) return;
  // Varsayılan menüdeki Cmd+W pencereyi, Cmd+R sayfayı (ve terminalleri) kapatır; ikisi de istenmiyor.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'toggleDevTools' }] },
    ]),
  );
  core = await AppCore.create(path.join(app.getPath('userData'), 'state.json'), () => win);
  core.register();
  // Klasör pencere açılmadan önce açılır: sayfa ilk durumu istediğinde repolar hazırdır.
  await core.openInitial(folderArg(process.argv) ?? process.env.EDI_OPEN_DIR);
  createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (quitting === 'yes') return;
  event.preventDefault();
  void requestQuit();
});
