# Running Servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List the localhost ports opened for listening in edi terminals in the status bar, open them in the browser on click, and show a port label on the tab.

**Architecture:** In the existing 3-second process poll (`IpcHandlers.pollProcesses`), the main process reads with `lsof` the TCP ports that non-shell processes on edi terminals' ttys are listening on, and sends them to the page as `ServerInfo[]` through the `servers` event only when they change. The page keeps them in the store; the status bar menu and the tab label are drawn from there. Opening uses the existing `edi.openUrl`.

**Tech Stack:** Electron 45, TypeScript, React 19, zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` → "Later additions" → "Running servers".

## Global Constraints

- edi does not send requests to servers, does not stop servers, and does not read terminal output.
- Only ports listening on `*`, `0.0.0.0`, `[::]`, `127.x.x.x`, `[::1]` count; the same port on IPv4+IPv6 counts once.
- If no tab has a non-shell process, `lsof` is not run.
- The list is sent only when it changes. The address is `http://localhost:PORT/`.
- UI copy is English, code comments and test names are Turkish. Tests do not touch real repos.

## Review Focus

1. Starting a server in the background with `&`: same tty, the tab title is the shell; the server must still be listed.
2. The same process on several ports (e.g. HMR on a separate port) or two servers in one tab: all must be listed, the label shows the first and `+N`.
3. If `lsof` is missing, slow or gives a permission error: the list stays empty and polling does not stop.
4. When the server stops or the tab closes: it drops off the list within one poll; when the folder changes, the list empties.
5. A process listening only on a LAN address (`192.168.x.x:3000`) and a process on a non-edi tty are not listed.

---

### Task 1: Finding servers in the main process

**Files:**
- Create: `src/servers.ts`
- Modify: `src/shared/api.ts` (ServerInfo, `EdiEvents.servers`), `src/preload/preload.cts` (`servers` in EVENTS), `src/main/ipc.ts` (pollProcesses)
- Test: `tests/servers.test.ts`

**Interfaces:**
- Produces (`src/shared/api.ts`): `interface ServerInfo { tabId: number; port: number; pid: number; cwd: string | null }`; `EdiEvents.servers: [servers: ServerInfo[]]`.
- Produces (`src/servers.ts`):
  - `parseListening(out: string): Map<number, number[]>` — `lsof -Fpn` output → pid → reachable ports (sorted, unique).
  - `serverCandidates(ptys: {id:number; pid:number; tty:string}[], ps: PsRow[]): Map<number, number>` — non-shell pid on an edi tty → tabId.
  - `serversFor(candidates, listening, cwds: Map<number,string>): ServerInfo[]` — sorted by port, unique by (tabId, port).
  - `listServers(ptys, ps): Promise<ServerInfo[]>` — does not call `lsof` when there are no candidates; `lsof -nP -a -iTCP -sTCP:LISTEN -p <pids> -Fpn`, then for the server pids `lsof -a -d cwd -p <pids> -Fpn` (`parseLsofPidCwd`). Any error gives an empty list.

- [ ] **Step 1: Tests** — `parseListening`: `*:5173`, `127.0.0.1:3000`, `[::1]:5173` (5173 once for the same pid), `[::]:8080`, `0.0.0.0:4000` count; `192.168.1.5:9000` does not. `serverCandidates`: the shell itself and a process on another tty are not candidates; a background process (pgid ≠ tpgid) is a candidate. `serversFor`: null when there is no cwd, port order. `listServers`: a real `node:net` server on `127.0.0.1:0`, with pid mapping instead of the test process's tty — instead of `listServers`, `readListening(pids)` (an exported helper) is called and that port is found on the test process's pid; with no candidates `lsof` is not called (a fake `run` is injected).
- [ ] **Step 2:** `npx vitest run tests/servers.test.ts` → FAIL because the module is missing.
- [ ] **Step 3:** Write `src/servers.ts`; the `run(cmd, args)` parameter defaults to `execFile` (5 s timeout, stdout whatever the exit code).
- [ ] **Step 4:** Wire into `pollProcesses`: `listServers(this.ptyInfos(), ps)`; `send('servers', …)` only on change, via `serversSent`. Add to the preload EVENTS. When the folder changes (the ptys are killed), the next poll sends an empty list.
- [ ] **Step 5:** `npm test` and `npm run typecheck` green. Commit: `feat(servers): find listening dev servers in terminals`.

### Task 2: List and tab label in the page

**Files:**
- Create: `src/renderer/servers/ServersMenu.tsx`, `src/renderer/servers/model.ts`
- Modify: `src/renderer/store.ts` (`servers: ServerInfo[]`, `edi.on('servers')`, emptied on folder change), `src/renderer/components/StatusBar.tsx`, `src/renderer/terminals/TabBar.tsx`, css
- Test: `tests/renderer/servers.test.tsx`

**Interfaces:**
- Consumes: `ServerInfo`, `edi.openUrl(url)`.
- Produces (`model.ts`):
  - `interface ServerRow { port: number; url: string; repoName: string | null; tabTitle: string | null; tabId: number }`
  - `serverRows(servers: ServerInfo[], tabs: {id:number; title:string}[], repos: {name:string; path:string}[]): ServerRow[]` — the repo is the longest repo path that contains the cwd; `url = http://localhost:PORT/`.
  - `tabPorts(servers: ServerInfo[], tabId: number): string | null` — `5173`, `5173 +1`, otherwise null.
- `ServersMenu` props: `{ rows: ServerRow[]; onOpen(url: string): void }`; renders nothing when there are no rows.

- [ ] **Step 1: Tests** — `serverRows` repo matching (`/a/b` repo, `/a/bc` cwd does not match), order; `tabPorts`; `ServersMenu`: counter `1 server` / `2 servers`, `aria-expanded`, `localhost:5173` in the menu, repo name and tab title; clicking a row calls `onOpen('http://localhost:5173/')` and the menu closes; no render when empty. TabBar: on a tab with a port, `data-testid="tab-port"` `5173`.
- [ ] **Step 2:** See FAIL.
- [ ] **Step 3:** Write; the menu uses the existing `usePopover` and the `.menu`/`.menu-item` classes, on the right of the status bar (to the left of center-info).
- [ ] **Step 4:** `npm test`, `npm run typecheck` green. Commit: `feat(servers): list running servers in the status bar`.

### Task 3: e2e and README

**Files:** `e2e/servers.spec.ts`, `README.md`

- [ ] **Step 1:** e2e: in an `EDI_SHELL=/bin/sh` terminal, run `node -e "require('http').createServer().listen(0,'127.0.0.1',function(){console.log('PORT',this.address().port)})"`; `1 server` in the status bar, `localhost:<port>` in the menu, a port label on the tab; after `Ctrl+C` the counter disappears. Clicking (it opens a browser) is not done in e2e.
- [ ] **Step 2:** One item in the README. `npm run e2e` green. Commit: `test(servers): cover the servers list end to end`.
