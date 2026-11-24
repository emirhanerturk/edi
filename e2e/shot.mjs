// Geliştirme yardımcısı: uygulamayı gizli pencerede açar ve ekran görüntüsü alır.
// Kullanım: node e2e/shot.mjs <çıktı.png> [açılacak klasör] [bekleme ms]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, openDir, wait = '1500'] = process.argv.slice(2);
const env = { ...process.env, EDI_HIDDEN: '1', EDI_USER_DATA: mkdtempSync(join(tmpdir(), 'edi-shot-')) };
delete env.ELECTRON_RUN_AS_NODE;
if (openDir) env.EDI_OPEN_DIR = openDir;

const app = await _electron.launch({ args: [root], env });
const page = await app.firstWindow();
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await app.close();
