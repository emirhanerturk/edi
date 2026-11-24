// Development helper: launches the app in a hidden window and takes a screenshot.
// Usage: node e2e/shot.mjs <out.png> [folder to open] [wait ms]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, openDir, wait = '1500'] = process.argv.slice(2);
const userData = mkdtempSync(join(tmpdir(), 'edi-shot-'));
const env = { ...process.env, EDI_HIDDEN: '1', EDI_USER_DATA: userData, EDI_USAGE_FILE: process.env.EDI_USAGE_FILE ?? join(userData, 'claude-usage.json') };
delete env.ELECTRON_RUN_AS_NODE;
if (openDir) env.EDI_OPEN_DIR = openDir;

const app = await _electron.launch({ args: [root], env });
const page = await app.firstWindow();
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await app.close();
