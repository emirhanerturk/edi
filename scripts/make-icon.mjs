// App icon: docs/design/icon/wordmark.svg → build/icon.icns. Runs with Electron
// (`npm run icon`): the SVG is drawn in a hidden window with IBM Plex Mono embedded, and macOS's
// sips and iconutil tools produce the iconset and the .icns.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app } from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;

const svg = readFileSync(join(root, 'docs/design/icon/wordmark.svg'), 'utf8');
const font = readFileSync(join(root, 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2')).toString('base64');
const html = `<!doctype html><html><head><style>
@font-face { font-family: 'IBM Plex Mono'; font-weight: 600; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; background: transparent; width: ${SIZE}px; height: ${SIZE}px; overflow: hidden; }
svg { display: block; }
</style></head><body>${svg}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const work = mkdtempSync(join(tmpdir(), 'edi-icon-'));
  try {
    const page = join(work, 'icon.html');
    writeFileSync(page, html);
    const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
    win.webContents.setZoomFactor(1);
    await win.loadFile(page);
    // Drawing before the font loads would show the fallback font.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => document.fonts.check("600 270px \'IBM Plex Mono\'"))').then((ok) => {
      if (!ok) throw new Error('IBM Plex Mono did not load');
    });
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
    const png = image.resize({ width: SIZE, height: SIZE }).toPNG();
    const master = join(work, 'icon-1024.png');
    writeFileSync(master, png);

    const iconset = join(work, 'icon.iconset');
    execFileSync('mkdir', ['-p', iconset]);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
        const px = size * scale;
        execFileSync('sips', ['-z', String(px), String(px), master, '--out', join(iconset, `icon_${size}x${size}${suffix}.png`)], { stdio: 'ignore' });
      }
    }
    execFileSync('mkdir', ['-p', join(root, 'build')]);
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')]);
    writeFileSync(join(root, 'build/icon-1024.png'), png);
    console.log('wrote build/icon.icns');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
