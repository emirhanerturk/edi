// Sayfaya açılan tek kapı. Burada yalnız dar, adı belli işlemler bulunur; sayfa serbest biçimli
// komut ya da kanal adı gönderemez.
import { contextBridge } from 'electron';
import type { EdiApi } from '../shared/api.js' with { 'resolution-mode': 'import' };

const api: EdiApi = { version: 1 };

contextBridge.exposeInMainWorld('edi', api);
