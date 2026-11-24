// ATILACAK DENEME — ürün kodu değil. Bkz. README.md
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverRepos } from '../../dist/git/discover.js';
import { getStatus } from '../../dist/git/status.js';
import { assignSessions, listClaudeCwds } from '../../dist/sessions.js';
import { repoSummary } from '../../dist/ui/rows.js';

const require = createRequire(import.meta.url);
const pty = require('node-pty');
const here = path.dirname(fileURLToPath(import.meta.url));

const SMOKE = process.env.EDI_SPIKE_SMOKE ?? ''; // '1': kabuk, 'claude': Claude Code sekmesi
const argDir = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const dir = fs.realpathSync(path.resolve(argDir ?? os.homedir()));

/** Kabuğa geçen ortam: iç içe Claude Code oturumu normal davransın diye bu oturumun izleri silinir. */
function shellEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'edi-spike' };
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('ELECTRON_') || key.startsWith('EDI_SPIKE_')) {
      delete env[key];
    }
  }
  return env;
}

const ptys = new Map();
let nextId = 1;
let win;

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

ipcMain.handle('config', () => ({ dir, home: os.homedir(), smoke: SMOKE }));

ipcMain.handle('pty:create', (_event, { cols, rows, command }) => {
  const id = nextId++;
  const shell = process.env.SHELL || '/bin/zsh';
  const proc = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd: dir, env: shellEnv() });
  ptys.set(id, proc);
  proc.onData((data) => send('pty:data', id, data));
  proc.onExit(() => {
    ptys.delete(id);
    send('pty:exit', id);
  });
  // Komut kabuğun içinde çalışır: Claude Code'dan çıkınca kabuk açık kalır.
  if (command) proc.write(`${command}\r`);
  return id;
});
ipcMain.on('pty:write', (_event, id, data) => ptys.get(id)?.write(data));
ipcMain.on('pty:resize', (_event, id, cols, rows) => {
  try {
    ptys.get(id)?.resize(Math.max(2, cols), Math.max(1, rows));
  } catch {
    // Kapanmakta olan pty.
  }
});
ipcMain.on('pty:kill', (_event, id) => ptys.get(id)?.kill());

// Her sekmede öndeki sürecin adı: Claude Code çalışıyorsa sekmede ✻ gösterilir.
setInterval(() => {
  const procs = {};
  // Claude Code'un çalıştırılabilir dosyası sürüm numarasıyla adlandırılıyor (ör. "2.1.331").
  // Deneme için yeterli; gerçek uygulamada tespit süreç adına değil tty'ye göre yapılmalı.
  for (const [id, proc] of ptys) procs[id] = /^\d+\.\d+\.\d+/.test(proc.process) ? 'claude' : proc.process;
  send('pty:procs', procs);
  if (SMOKE) console.log(`PROCS ${JSON.stringify(procs)}`);
}, 1000);

// Sağ panel: git çekirdeğiyle salt okunur repo listesi.
let repos = [];
let sessions = { root: 0, byRepo: {} };
async function pollRepos() {
  if (repos.length === 0) repos = await discoverRepos(dir);
  const rows = await Promise.all(
    repos.map(async (repo) => {
      const result = await getStatus(repo.path);
      const summary = repoSummary({ status: result.ok ? result.status : null, error: result.ok ? null : result.error, busy: null });
      return { name: repo.name, ...summary, claude: sessions.byRepo[repo.path] ?? 0, files: result.ok ? result.status.files : [] };
    }),
  );
  send('repos', { rows, rootSessions: sessions.root });
}
async function pollSessions() {
  sessions = assignSessions(await listClaudeCwds(), dir, repos);
}
setInterval(() => pollRepos().catch(() => {}), 2000);
setInterval(() => pollSessions().catch(() => {}), 5000);

ipcMain.on('smoke:result', async (_event, result) => {
  if (!SMOKE) return;
  const shot = process.env.EDI_SPIKE_SHOT;
  if (shot) fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
  console.log(`SMOKE ${JSON.stringify(result)}`);
  app.exit(result.ok ? 0 : 1);
});

app.whenReady().then(async () => {
  // Varsayılan menü Cmd+W ile pencereyi, Cmd+R ile sayfayı (ve terminalleri) kapatır; ikisi de istenmiyor.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { label: 'Geliştirici', submenu: [{ role: 'toggleDevTools' }] }]),
  );
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: '#1e2127',
    title: `edi deneme — ${dir}`,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(here, 'index.html'));
  await pollSessions().catch(() => {});
  await pollRepos().catch(() => {});
  if (SMOKE) {
    setTimeout(async () => {
      const shot = process.env.EDI_SPIKE_SHOT;
      if (shot) fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
      console.log('SMOKE {"ok":false,"error":"zaman aşımı"}');
      app.exit(1);
    }, 25000);
  }
});

app.on('window-all-closed', () => {
  for (const proc of ptys.values()) proc.kill();
  app.quit();
});
