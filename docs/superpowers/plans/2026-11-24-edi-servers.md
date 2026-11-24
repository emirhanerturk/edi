# Çalışan Sunucular Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** edi terminallerinde dinlemeye açılmış localhost portlarını durum çubuğunda listelemek, tıklayınca tarayıcıda açmak ve sekmede port etiketi göstermek.

**Architecture:** Ana süreç, mevcut 3 saniyelik süreç yoklamasında (`IpcHandlers.pollProcesses`) edi terminallerinin tty'sindeki kabuk dışı süreçlerin dinlediği TCP portlarını `lsof` ile okur, `ServerInfo[]` olarak yalnız değişince `servers` olayıyla sayfaya gönderir. Sayfa bunları store'da tutar; durum çubuğundaki menü ve sekme etiketi buradan çizilir. Açma, mevcut `edi.openUrl`.

**Tech Stack:** Electron 45, TypeScript, React 19, zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` → "Sonradan eklenenler" → "Çalışan sunucular".

## Global Constraints

- edi sunuculara istek atmaz, sunucu durdurmaz, terminal çıktısını okumaz.
- Yalnız `*`, `0.0.0.0`, `[::]`, `127.x.x.x`, `[::1]` üzerinde dinleyen portlar sayılır; aynı port IPv4+IPv6 tek sayılır.
- Hiçbir sekmede kabuk dışı süreç yoksa `lsof` çalıştırılmaz.
- Liste yalnız değişince gönderilir. Adres `http://localhost:PORT/`.
- UI metni İngilizce, kod yorumları ve test adları Türkçe. Testler gerçek repolara dokunmaz.

## Review Focus

1. Sunucuyu `&` ile arka planda başlatmak: tty aynı, sekme başlığı kabuk; sunucu yine listelenmeli.
2. Aynı süreç birden çok portta (ör. HMR ayrı port) ya da bir sekmede iki sunucu: hepsi listelenmeli, etikette ilki ve `+N`.
3. `lsof` çıkmazsa, yavaşsa ya da izin hatası verirse: liste boş kalır, yoklama durmaz.
4. Sunucu kapanınca ya da sekme kapanınca: bir yoklamada listeden düşer; klasör değişince liste boşalır.
5. Yalnız LAN adresinde (`192.168.x.x:3000`) dinleyen süreç ve edi dışı tty'deki süreç listelenmez.

---

### Task 1: Ana süreçte sunucuları bulmak

**Files:**
- Create: `src/servers.ts`
- Modify: `src/shared/api.ts` (ServerInfo, `EdiEvents.servers`), `src/preload/preload.cts` (EVENTS'e `servers`), `src/main/ipc.ts` (pollProcesses)
- Test: `tests/servers.test.ts`

**Interfaces:**
- Produces (`src/shared/api.ts`): `interface ServerInfo { tabId: number; port: number; pid: number; cwd: string | null }`; `EdiEvents.servers: [servers: ServerInfo[]]`.
- Produces (`src/servers.ts`):
  - `parseListening(out: string): Map<number, number[]>` — `lsof -Fpn` çıktısı → pid → erişilebilir portlar (sıralı, tekrarsız).
  - `serverCandidates(ptys: {id:number; pid:number; tty:string}[], ps: PsRow[]): Map<number, number>` — kabuk dışı, edi tty'sindeki pid → tabId.
  - `serversFor(candidates, listening, cwds: Map<number,string>): ServerInfo[]` — port'a göre sıralı, (tabId, port) tekrarsız.
  - `listServers(ptys, ps): Promise<ServerInfo[]>` — aday yoksa `lsof` çağırmaz; `lsof -nP -a -iTCP -sTCP:LISTEN -p <pids> -Fpn`, sonra sunucu pid'leri için `lsof -a -d cwd -p <pids> -Fpn` (`parseLsofPidCwd`). Her hata boş liste.

- [ ] **Step 1: Testler** — `parseListening`: `*:5173`, `127.0.0.1:3000`, `[::1]:5173` (aynı pid'de 5173 tek), `[::]:8080`, `0.0.0.0:4000` sayılır; `192.168.1.5:9000` sayılmaz. `serverCandidates`: kabuğun kendisi ve başka tty'deki süreç aday değil; arka plandaki (pgid ≠ tpgid) süreç aday. `serversFor`: cwd yoksa null, port sırası. `listServers`: gerçek `node:net` sunucusu `127.0.0.1:0` üzerinde, test sürecinin tty'si yerine pid eşlemesiyle — `listServers` yerine `readListening(pids)` (dışa açık yardımcı) çağrılıp test sürecinin pid'inde o port bulunur; aday yokken `lsof` çağrılmaz (sahte `run` enjekte edilir).
- [ ] **Step 2:** `npx vitest run tests/servers.test.ts` → modül yok diye FAIL.
- [ ] **Step 3:** `src/servers.ts`'i yaz; `run(cmd, args)` parametresi varsayılanı `execFile` (5 s zaman aşımı, çıkış kodu ne olursa stdout).
- [ ] **Step 4:** `pollProcesses`'e bağla: `listServers(this.ptyInfos(), ps)`; `serversSent` ile yalnız değişince `send('servers', …)`. Preload EVENTS'e ekle. Klasör değişince (pty'ler öldürülür) sonraki yoklama boş liste gönderir.
- [ ] **Step 5:** `npm test` ve `npm run typecheck` yeşil. Commit: `feat(servers): find listening dev servers in terminals`.

### Task 2: Sayfada liste ve sekme etiketi

**Files:**
- Create: `src/renderer/servers/ServersMenu.tsx`, `src/renderer/servers/model.ts`
- Modify: `src/renderer/store.ts` (`servers: ServerInfo[]`, `edi.on('servers')`, klasör değişince boşalt), `src/renderer/components/StatusBar.tsx`, `src/renderer/terminals/TabBar.tsx`, css
- Test: `tests/renderer/servers.test.tsx`

**Interfaces:**
- Consumes: `ServerInfo`, `edi.openUrl(url)`.
- Produces (`model.ts`):
  - `interface ServerRow { port: number; url: string; repoName: string | null; tabTitle: string | null; tabId: number }`
  - `serverRows(servers: ServerInfo[], tabs: {id:number; title:string}[], repos: {name:string; path:string}[]): ServerRow[]` — repo, cwd'yi içeren en uzun repo yolu; `url = http://localhost:PORT/`.
  - `tabPorts(servers: ServerInfo[], tabId: number): string | null` — `5173`, `5173 +1`, yoksa null.
- `ServersMenu` props: `{ rows: ServerRow[]; onOpen(url: string): void }`; satır yoksa hiçbir şey çizmez.

- [ ] **Step 1: Testler** — `serverRows` repo eşleşmesi (`/a/b` repo, `/a/bc` cwd eşleşmez), sıra; `tabPorts`; `ServersMenu`: sayaç `1 server` / `2 servers`, `aria-expanded`, menüde `localhost:5173`, repo adı ve sekme başlığı; satıra tık `onOpen('http://localhost:5173/')` ve menü kapanır; boşta render yok. TabBar: portlu sekmede `data-testid="tab-port"` `5173`.
- [ ] **Step 2:** FAIL gör.
- [ ] **Step 3:** Yaz; menü mevcut `usePopover` ve `.menu`/`.menu-item` sınıflarıyla, durum çubuğunda sağa (center-info'nun soluna).
- [ ] **Step 4:** `npm test`, `npm run typecheck` yeşil. Commit: `feat(servers): list running servers in the status bar`.

### Task 3: e2e ve README

**Files:** `e2e/servers.spec.ts`, `README.md`

- [ ] **Step 1:** e2e: `EDI_SHELL=/bin/sh` terminalinde `node -e "require('http').createServer().listen(0,'127.0.0.1',function(){console.log('PORT',this.address().port)})"` çalıştır; durum çubuğunda `1 server`, menüde `localhost:<port>`, sekmede port etiketi; `Ctrl+C` sonrası sayaç kaybolur. Tıklama (tarayıcı açar) e2e'de yapılmaz.
- [ ] **Step 2:** README'ye bir madde. `npm run e2e` yeşil. Commit: `test(servers): cover the servers list end to end`.
