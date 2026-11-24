# edi desktop app — plan 1: shell, terminals and the Git tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dev` opens the edi window: pick a folder, work in terminal tabs (Claude tabs recognised), and stage, commit, push, pull, fetch and switch branches for every repo from the Git tab.

**Architecture:** Electron main process owns git (existing `src/git/*`), ptys, process detection and persisted state; a sandboxed React renderer talks to it through one typed preload bridge. Main pushes whole-workspace snapshots to the renderer; the renderer sends a repo path plus a typed operation, never a command.

**Tech Stack:** Electron 45, TypeScript 7, React 19, Vite 8, zustand 5, @xterm/xterm 6 (+fit, +webgl), node-pty 1.1, Vitest 5 (+ Testing Library, jsdom), Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md`. Visual source: `docs/design/edi-ui/*.dc.html`.

This is plan 1 of 4. Later plans: (2) center panel — diff view, file view, Files tab, Open in Zed; (3) History tab and commit view; (4) packaging (`npm run dist`), spike removal if still present, polish. The center panel, History and Files tabs are **not** built here: file rows are not clickable yet and the right panel shows only the Git tab.

## Global Constraints

- Never run or add code paths for: `reset --hard`, `checkout -- <path>`, `restore` (worktree), `clean`, force push, `rebase`, `--no-verify`, `fetch --prune`.
- No automatic fetch/pull/push. The app writes to a terminal only for "new Claude session" (`claude\r`).
- No network: fonts bundled via `@fontsource/*`; no telemetry; no remote URLs in the renderer.
- Tests use temp dirs and local bare remotes only; nothing under `~/studios` is touched.
- UI copy is English and matches the artboards. Code comments stay Turkish like the existing code.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Every IPC call that names a repo is validated in main against the discovered repo list.
- Colors (CSS variables in `theme.css`): `--bg #282C34`, `--panel #21252B`, `--panel-open #252930`, `--input #1B1D23`, `--selected #2F343E`, `--line #181A1F`, `--line-soft #1B1E23`, `--border #3E4451`, `--chip #31363F`, `--chip-strong #3A3F4B`, `--text #D7DAE0`, `--text-2 #ABB2BF`, `--muted #969DA8`, `--accent #D7DAE0`, `--on-accent #1B1D23`, `--yellow #E5C07B`, `--green #98C379`, `--red #E06C75`, `--cyan #56B6C2`, `--claude #D97757`.
- Type: IBM Plex Sans 13px UI; IBM Plex Mono 12px for paths, branches, commit message. Terminal font `'SF Mono', Menlo, Monaco, monospace` 13px.
- npm 12 blocks dependency install scripts: after `npm install`, `npm run setup` makes node-pty's `spawn-helper` executable and downloads the Electron binary.
- Conventional Commits 1.0.0 for every commit; footer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. A repo path that is not in the discovered list (or a path with `..`) sent over IPC must be rejected without running git. → Task 9 test.
2. A second write on a repo while one is running returns "Another operation is still running" and does not disturb the first. → Task 9 test.
3. A repo folder deleted while the app is open: its row shows an error, the other repos keep refreshing. → Task 5 test.
4. Commit messages that are multi-line, start with `-`, or contain quotes and `$()` are committed byte-for-byte and never interpreted. → Task 9 test.
5. A shell that exits, and writes/resizes sent to a dead pty, must not throw or kill other tabs; the pty env never contains `CLAUDECODE`, `CLAUDE_CODE_*`, `ELECTRON_*`. → Task 6 tests.

---

### Task 1: Drop the TUI, English core strings, HEAD oid

**Files:**
- Delete: `src/ui/rows.ts`, `tests/rows.test.ts`
- Modify: `package.json` (remove `ink`, `ink-testing-library`, `tsx`, `bin`, `dev` script; description → `"Git-aware terminal manager for multi-repo work"`), `src/git/exec.ts`, `src/git/actions.ts`, `src/git/status.ts`, `tests/exec.test.ts`, `tests/actions.test.ts`, `tests/status.test.ts`

**Interfaces:**
- Produces: `RepoStatus.headOid: string | null` (full oid from `# branch.oid`; `null` when unborn). `statusTag` and `diffRepo` removed. `gitEnv` sets `LC_ALL=C` and `LANG=C`.
- Strings: `Staged`, `Unstaged`, `Committed`, `Pushed`, `Pulled`, `Fetched`, `` `Switched to ${name}` ``, `Commit message is empty`, `Detached HEAD: cannot push`, `Conflicted files present; resolve them outside edi`, `Timed out`, `git failed`.

- [ ] **Step 1:** Update tests first: replace every Turkish expectation with the strings above; add to `tests/status.test.ts` `'parseStatus returns the HEAD oid'` (`headOid` equals the 40-char oid in the fixture) and `'headOid is null in a repo with no commits'`; add to `tests/exec.test.ts` `'git output is English regardless of locale'` (run with `process.env.LANG='tr_TR.UTF-8'` set, `runGit(tmp, ['status'])` in a non-repo → error starts with `fatal: not a git repository`). Remove `diffRepo` and `statusTag` tests.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL on the changed expectations and `headOid`.
- [ ] **Step 3:** Change the strings, add `headOid`, set locale in `gitEnv`, delete `diffRepo`, `statusTag`, `src/ui/`, `tests/rows.test.ts`, and the package.json entries; `npm install`.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor!: drop the terminal UI and switch core messages to English`.

### Task 2: Close the deferred review findings in the git core

**Files:**
- Modify: `src/git/exec.ts`, `src/git/actions.ts`, `src/git/status.ts`
- Test: `tests/exec.test.ts`, `tests/actions.test.ts`, `tests/status.test.ts`

**Interfaces:**
- Produces: `push(repo, status)` uses `push -u origin refs/heads/<head>` when `status.upstream === null || status.ahead === null`. `switchBranch`/`createBranch` return `{ ok: false, error: 'Invalid branch name' }` for names that are empty or start with `-`. `runGit` returns `{ ok: false, error: 'Repository folder not found' }` when `cwd` does not exist. `FileChange.origPath` is set only for renames.

- [ ] **Step 1: Write failing tests**
  - `'a branch named like a tag is listed by its short name'`: branch `release` + tag `release` → `listBranches` contains `'release'`, not `'heads/release'`.
  - `'push republishes a branch whose upstream was deleted'`: push branch `feat`, delete it on the bare remote (`git push origin --delete feat` then `git remote prune origin` in the test), commit, `push()` → ok and `git ls-remote origin refs/heads/feat` is non-empty.
  - `'a new branch named like a tag is pushed'`: branch `v1` + tag `v1`, no upstream → `push()` ok and remote has `refs/heads/v1`.
  - `'a branch name starting with a dash is rejected'`: `switchBranch(repo, '--detach')` and `createBranch(repo, '-x')` → `Invalid branch name`; HEAD unchanged.
  - `'clear error for a deleted repo folder'`: `runGit(join(tmp, 'gone'), ['status'])` → `Repository folder not found`.
  - `'a hook that backgrounds a process does not count as a timeout'`: `post-commit` hook `#!/bin/sh\n(sleep 6) &\n`, `runGit(repo, ['commit', '-m', 'x'], { timeoutMs: 4000 })` → ok, resolves in under 3 s.
  - `'origPath is empty on a copy record'`: `parseStatus` on a `2 C. … C100 new\0old\0` record → `origPath === null`; rename record still has it.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL on the seven new tests.
- [ ] **Step 3:** Implement. Branch list via `--format=%(refname:lstrip=2)`. `runGit`: check `cwd` with `fs.stat` before spawn; resolve on `exit` after a 200 ms grace for `close` (keep collecting output until then).
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(git): close the deferred review findings`.

### Task 3: Processes by tty and terminal-only Claude sessions

**Files:**
- Create: `src/procs.ts`, `tests/procs.test.ts`
- Modify: `src/sessions.ts`, `tests/sessions.test.ts`

**Interfaces:**
- Produces (`src/procs.ts`):
  ```ts
  export interface PsRow { pid: number; pgid: number; tpgid: number; tty: string; args: string } // tty: 'ttys003' | '' (none)
  export function parsePs(out: string): PsRow[]            // `ps -axww -o pid=,pgid=,tpgid=,tty=,args=`
  export function listPs(): Promise<PsRow[]>               // error → []
  export function foreground(rows: PsRow[], tty: string): PsRow[]   // those on the tty with pgid === tpgid
  export interface TabInfo { title: string; claude: boolean; busy: boolean }
  export function tabInfo(fg: PsRow[], shellPid: number, shellName: string, claudePids: ReadonlySet<number>): TabInfo
  ```
  `tabInfo`: any fg pid in `claudePids` → `{ title: 'claude', claude: true, busy: true }`; fg is only the shell (or empty) → `{ title: shellName, claude: false, busy: false }`; otherwise title is the group leader's `args` with the first word reduced to its basename, cut to 40 chars, `busy: true`.
- Produces (`src/sessions.ts`):
  ```ts
  export function parseLsofPidCwd(out: string): Map<number, string>
  export function listClaudePids(): Promise<number[]>
  export interface ClaudeSession { pid: number; cwd: string; tty: string }
  export function listClaudeSessions(ps: PsRow[]): Promise<ClaudeSession[]>  // only those with a tty
  ```
  `assignSessions(cwds, dir, repos)` unchanged. `listClaudeCwds` and `parseLsofCwd` removed.

- [ ] **Step 1: Write failing tests** — `parsePs` (args with spaces, tty `??` → `''`, blank lines ignored); `foreground` picks only `pgid === tpgid` rows of that tty; `tabInfo` three cases (`/opt/homebrew/bin/node /x/npm run dev` → `node /x/npm run dev`); `parseLsofPidCwd` on `p12\nfcwd\nn/a/b\np13\nfcwd\nn/c\n`; `listClaudeSessions` filter tested through an exported pure helper `joinSessions(pids, cwdByPid, ps)` that drops pids without tty or cwd.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: detect foreground processes by tty and terminal Claude sessions`.

### Task 4: Electron scaffold, theme and first smoke test

**Files:**
- Create: `tsconfig.main.json`, `tsconfig.renderer.json`, `vite.config.ts`, `playwright.config.ts`, `scripts/dev.mjs`, `scripts/setup-native.mjs`, `src/shared/api.ts`, `src/main/main.ts`, `src/preload/preload.cts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/theme.css`, `e2e/helpers.ts`, `e2e/app.spec.ts`
- Modify: `package.json`, `tsconfig.json` (exclude `src/renderer`, `tests/renderer`, `e2e`), `tsconfig.build.json` (delete), `.gitignore` (`test-results`, `playwright-report`)

**Interfaces:**
- Scripts: `setup` → `node scripts/setup-native.mjs`; `build` → `tsc -p tsconfig.main.json && vite build`; `dev` → `node scripts/dev.mjs`; `start` → `npm run build && electron .`; `typecheck` → `tsc --noEmit && tsc --noEmit -p tsconfig.renderer.json`; `e2e` → `npm run build && playwright test`. `"main": "dist/main/main.js"`.
- Output layout: `dist/main/main.js` (ESM), `dist/preload/preload.cjs`, `dist/renderer/index.html`.
- Env read by main: `EDI_USER_DATA` (userData dir override), `EDI_OPEN_DIR` (folder to open at start), `VITE_DEV_SERVER_URL` (dev).
- Window: 1440×900, min 900×560, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition { x: 14, y: 12 }`, `backgroundColor '#282C34'`. Menu: appMenu, editMenu, a View menu with only toggleDevTools — no `close`/`reload` roles.
- `e2e/helpers.ts`: `launch(opts?: { openDir?: string }): Promise<{ app: ElectronApplication; page: Page; userData: string }>` (temp userData every launch).

- [ ] **Step 1:** Install deps (`electron`, `vite`, `@vitejs/plugin-react`, `react-dom`, `@types/react-dom`, `zustand`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, `@testing-library/react`, `jsdom`, `@playwright/test` as dev; `node-pty` as dependency), write `scripts/setup-native.mjs`, run `npm run setup`.
- [ ] **Step 2: Write the failing e2e** `'the window opens and the title bar says edi'`: launch, expect `page.getByTestId('titlebar')` to contain text `edi`, and `getComputedStyle(document.body).backgroundColor` to be `rgb(40, 44, 52)`.
- [ ] **Step 3:** Run `npm run e2e`. Expected: FAIL (no build output).
- [ ] **Step 4:** Write configs, `main.ts`, `preload.cts` (exposes an empty `edi` object for now), renderer entry with `theme.css` tokens, font imports and an `App` rendering the title bar strip.
- [ ] **Step 5:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 6:** Commit `build: scaffold the Electron app with a sandboxed React renderer`.

### Task 5: Persisted state, workspace polling, title bar, empty state, status bar

**Files:**
- Create: `src/main/store.ts`, `src/main/workspace.ts`, `src/main/ipc.ts`, `src/renderer/store.ts`, `src/renderer/bridge.ts`, `src/renderer/components/{TitleBar,StatusBar,EmptyState,icons}.tsx`, `src/renderer/format.ts`
- Test: `tests/store.test.ts`, `tests/workspace.test.ts`, `tests/renderer/format.test.ts`, `e2e/app.spec.ts`

**Interfaces:**
- `src/shared/api.ts`:
  ```ts
  export interface RepoView { name: string; path: string; status: RepoStatus | null; error: string | null; busy: string | null; claude: number }
  export interface WorkspaceView { dir: string | null; repos: RepoView[]; rootSessions: number; refreshedAt: number }
  export interface RecentFolder { dir: string; repoCount: number }
  export interface Layout { left: number; right: number; diffMode: 'split' | 'inline'; historyLayout: 'timeline' | 'byRepo' }
  export interface AppState { home: string; workspace: WorkspaceView; recent: RecentFolder[]; layout: Layout }
  ```
- `src/main/store.ts`: `interface Persisted { lastDir: string | null; recent: RecentFolder[]; layout: Layout; window: { x: number; y: number; width: number; height: number } | null }`, `DEFAULTS`, `loadState(file): Promise<Persisted>` (missing/corrupt/partial → defaults merged), `saveState(file, s): Promise<void>` (write temp + rename), `addRecent(s, dir, repoCount): Persisted` (dedupe, newest first, max 8). Default layout `{ left: 492, right: 372, diffMode: 'split', historyLayout: 'timeline' }`.
- `src/main/workspace.ts`:
  ```ts
  export class Workspace {
    constructor(opts: { onChange: (view: WorkspaceView) => void; statusMs?: number; sessionsMs?: number })
    open(dir: string): Promise<{ ok: true; repoCount: number } | { ok: false; error: string }>  // realpath; error if not a folder
    rescan(): Promise<void>
    view(): WorkspaceView
    repo(path: string): RepoView | null     // discovered paths only
    refresh(path: string): Promise<void>
    setBusy(path: string, label: string | null): void
    dispose(): void
  }
  ```
  Status polling default 2000 ms with an in-flight guard per repo; sessions 3000 ms.
- Bridge (`EdiApi`, grows in later tasks): `getState(): Promise<AppState>`, `chooseFolder(): Promise<void>`, `openFolder(dir: string): Promise<{ ok: boolean; error?: string }>`, `rescan(): Promise<void>`, `on(channel: 'workspace', cb: (v: WorkspaceView) => void): () => void`, `on(channel: 'recent', cb: (r: RecentFolder[]) => void): () => void`.
- `src/renderer/format.ts`: `tildify(path, home): string`, `plural(n, one, many): string`, `summary(view): { repos: number; withChanges: number; toPush: number }`.

- [ ] **Step 1: Write failing tests**
  - store: `'defaults when the file is missing'`, `'corrupt JSON falls back to defaults'`, `'missing fields are filled from defaults'`, `'addRecent moves a duplicate to the front and caps at 8'`, `'saveState then loadState returns the same value'`.
  - workspace (temp repos, `statusMs: 50`): `'repos in subfolders come with their status'`, `'a file change shows up on the next poll'`, `'a deleted repo shows an error, the others keep refreshing'` (Review Focus 3), `'repo() is null for an undiscovered path'`, `'a path that is not a folder is rejected'`.
  - format: `tildify('/Users/x/studios/q', '/Users/x') === '~/studios/q'`; `summary` counts.
  - e2e `'Open a folder shows in the empty state'`; `'opened with EDI_OPEN_DIR, the repo count is in the status bar'` (two temp repos → `2 repositories`, title bar shows the folder name).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement main side, IPC registration, preload, zustand store subscribing to `workspace`, and the three components per `Bos.dc.html` / `Main.dc.html` (title bar: traffic-light gap, `edi`, folder button opening a menu of recent folders + `Choose folder…`, `N sessions` with Claude mark when > 0; status bar: `N repositories`, `● N with changes`, `↑ N to push`, right side `refreshed Ns ago`). Window bounds and `lastDir` persist; startup opens `EDI_OPEN_DIR`, else `lastDir` if it still exists.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: open a folder and keep every repo's status live`.

### Task 6: Terminals

**Files:**
- Create: `src/main/pty.ts`, `src/renderer/terminals/{TerminalPanel,TabBar,terminals}.tsx|ts`
- Modify: `src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/preload.cts`, `src/renderer/App.tsx`, `src/renderer/store.ts`
- Test: `tests/pty.test.ts`, `e2e/terminal.spec.ts`

**Interfaces:**
- `src/main/pty.ts`:
  ```ts
  export function shellEnv(base: NodeJS.ProcessEnv): Record<string, string>  // TERM, COLORTERM, TERM_PROGRAM=edi; CLAUDECODE, CLAUDE_CODE_*, ELECTRON_*, EDI_* removed
  export class PtyManager {
    constructor(opts: { shell?: string; onData: (id: number, data: string) => void; onExit: (id: number) => void })
    create(o: { cols: number; rows: number; cwd: string; command?: string }): number   // `<shell> -l`; if command is set, `${command}\r` is written
    write(id: number, data: string): void      // unknown/dead id: silently ignored
    resize(id: number, cols: number, rows: number): void
    kill(id: number): void
    info(id: number): { pid: number; tty: string; shell: string } | null   // tty: 'ttys003'
    ids(): number[]
    killAll(): void
  }
  ```
- Bridge adds: `pty.create(o: { cols: number; rows: number; repoPath?: string; claude?: boolean }): Promise<number>` (cwd = validated repo path or workspace dir; `claude` → command `claude`), `pty.write(id, data): void`, `pty.resize(id, cols, rows): void`, `pty.close(id): Promise<void>`, `on('pty:data', (id, data) => void)`, `on('pty:exit', (id) => void)`.
- Renderer tab model: `interface Tab { id: number; title: string; claude: boolean; waiting: boolean; busy: boolean; exited: boolean }`; store actions `newTab(o?: { claude?: boolean; repoPath?: string })`, `closeTab(id)`, `activate(id)`.
- `terminals.ts` keeps one xterm `Terminal` per tab id outside React (options exactly as in the spike: font stack, `fontSize 13`, `lineHeight 1.2`, `scrollback 10000`, `macOptionIsMeta false`, One Dark ANSI theme with `background #282C34`); Shift+Enter writes `\x1b\r`.
- Shortcuts (handled in the xterm key handler and on `window`): Cmd+T new terminal, Cmd+Shift+T new Claude session, Cmd+W close active tab, Cmd+1…9 switch, Cmd+O choose folder.
- Tab bar per `Main.dc.html`: shrinking tabs with ellipsis, close cross on the active tab, `+` and Claude buttons at the right; `data-testid="tab"`, `data-testid="new-terminal"`, `data-testid="new-claude"`.
- An exited tab stays, shows `exited`, and is closed by the user. Closing a tab whose `busy` is true asks `window.confirm('A process is still running in this terminal. Close it?')`.

- [ ] **Step 1: Write failing tests**
  - `'shellEnv removes Claude Code and Electron traces'` (Review Focus 5).
  - `'pty returns command output and reports exit'`: shell `/bin/sh`, `write(id, 'echo edi-$((40+2)); exit\n')` → collected data contains `edi-42`, `onExit` fires.
  - `'writing to and resizing a dead pty does not throw'`; `'one tab exiting does not affect another'`; `'info returns the tty name without the /dev prefix'` (`/^ttys\d+$/`).
  - e2e `'a command typed in the terminal runs'`: open temp workspace, focus terminal, type `touch edi-marker\n`, poll until `<workspace>/edi-marker` exists; `'Cmd+T opens a second tab'` (two `tab` elements).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. A first tab opens automatically when a workspace opens. Opening another folder kills all ptys (confirm first if any tab is busy).
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: terminal tabs backed by real ptys`.

### Task 7: Tab titles, Claude tabs and session counts

**Files:**
- Create: `src/main/tabs.ts`, `tests/tabs.test.ts`
- Modify: `src/main/workspace.ts`, `src/main/ipc.ts`, `src/shared/api.ts`, `src/preload/preload.cts`, `src/renderer/store.ts`, `src/renderer/terminals/TabBar.tsx`

**Interfaces:**
- `src/main/tabs.ts`: `export interface TabState { id: number; title: string; claude: boolean; busy: boolean }`, `export function tabStates(ptys: { id: number; pid: number; tty: string; shell: string }[], ps: PsRow[], claudePids: ReadonlySet<number>): TabState[]` (shell name = basename of shell path).
- One 3000 ms poll in main does `listPs()` + `listClaudePids()` once, then emits `tabs` (`TabState[]`) and updates workspace sessions via `listClaudeSessions(ps)` + `assignSessions`.
- Bridge adds `on('tabs', (t: TabState[]) => void)`.
- A Claude tab shows the Claude mark (stroke `#D97757`) and title `claude`.

- [ ] **Step 1: Write failing tests** — `tabStates`: shell-only tty → `{ title: 'zsh', claude: false, busy: false }`; fg `npm run dev` → that title, busy; fg pid in `claudePids` → claude; a pty whose tty has no rows → shell title.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire to the tab bar and to `RepoView.claude` / `rootSessions`.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS. Then run the app once against a temp workspace and confirm by eye (screenshot via Playwright) that a tab running `sleep 30` shows `sleep 30`.
- [ ] **Step 5:** Commit `feat: name tabs after their foreground process and mark Claude tabs`.

### Task 8: Git tab — read side

**Files:**
- Create: `src/renderer/git/{model.ts,GitPanel.tsx,RepoRow.tsx,RepoOpen.tsx,FileRow.tsx}`
- Modify: `src/renderer/App.tsx`, `src/renderer/store.ts`
- Test: `tests/renderer/model.test.ts`, `tests/renderer/GitPanel.test.tsx`, `e2e/git.spec.ts`

**Interfaces:**
- `model.ts` (pure):
  ```ts
  export type SyncAction = { kind: 'pull' | 'push' | 'publish'; label: string } | null
  export function syncAction(s: RepoStatus): SyncAction
  // behind>0 → Pull n; ahead>0 → Push n; no upstream (or deleted), not unborn, not detached → Publish branch; otherwise null
  export interface FileGroups { conflicts: FileChange[]; staged: FileChange[]; changes: FileChange[] }
  export function groupFiles(s: RepoStatus): FileGroups     // a partly staged file is in both groups
  export function letter(f: FileChange, group: 'staged' | 'changes' | 'conflicts'): string  // staged→x, changes→y, untracked '?', conflict 'U'
  export function letterColor(l: string): string             // M yellow, A/? green, D/U red, R/C cyan
  export function splitPath(p: string): { name: string; dir: string }
  export function changeCount(s: RepoStatus): number          // number of unique paths
  export function isPartlyStaged(f: FileChange): boolean
  export function commitTarget(g: FileGroups): { all: boolean; count: number; label: string; enabled: boolean }
  // if staged: 'Commit · N files' (1 → 'file'); otherwise, if changes: 'Commit all · N files'; if conflicts and nothing staged: enabled false
  ```
- Publish with no commits to publish: a branch with no upstream **and** unborn → null.
- Expansion state: repos with changes default open, clean default closed; a user toggle is stored per repo path in the renderer store for the session.
- Rows per `Main.dc.html` / `GitPaneli.dc.html`: collapsed row = chevron, name (ellipsis), Claude mark if `claude > 0`, spacer, branch (mono, max 130px), state (`✓` green, or change count in yellow), sync button. Open repo = header (name, branch button, pull, push, open-terminal icon buttons), commit box placeholder (built in Task 9), groups `CONFLICTS`, `STAGED`, `CHANGES` with counts; deleted files struck through; `partly staged` chip in the staged group. `merging` chip when conflicts exist. Error state row: red triangle + error text.
- Git tab badge = sum of `changeCount`. No repos → `No git repositories in this folder`.
- Test ids: `repo-row` (with `data-repo=<name>`), `file-row`, `sync-button`, `git-badge`.

- [ ] **Step 1: Write failing tests** — model: each `syncAction` branch incl. ahead+behind → Pull, gone upstream → Publish, unborn → null; `groupFiles` puts `MM` in both groups, untracked in changes, conflicted only in conflicts; `letter`/`letterColor`; `commitTarget` four cases incl. `1 file`. Component (jsdom): GitPanel with a fixture of three repos renders names, `Push 1` on the ahead repo, files only under the dirty repo, badge equals total. e2e `'a changed file shows in the Git tab'`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: show every repo's branch, sync state and changes in the Git tab`.

### Task 9: Git tab — actions

**Files:**
- Create: `src/main/gitOps.ts`, `src/renderer/git/{CommitBox.tsx,BranchMenu.tsx,ErrorBox.tsx}`
- Modify: `src/shared/api.ts`, `src/main/ipc.ts`, `src/main/workspace.ts`, `src/preload/preload.cts`, `src/git/actions.ts`, `src/renderer/git/*`, `src/renderer/store.ts`
- Test: `tests/gitOps.test.ts`, `tests/actions.test.ts`, `tests/renderer/CommitBox.test.tsx`, `e2e/git.spec.ts`

**Interfaces:**
- `src/shared/api.ts`:
  ```ts
  export type GitOp =
    | { op: 'stage'; file: FileChange } | { op: 'unstage'; file: FileChange }
    | { op: 'stageAll' } | { op: 'unstageAll' }
    | { op: 'commit'; message: string; all: boolean; push: boolean }
    | { op: 'push' } | { op: 'pull' } | { op: 'fetch' }
    | { op: 'switch'; branch: string } | { op: 'createBranch'; branch: string }
  export type OpResult = { ok: true; message: string } | { ok: false; error: string }
  ```
- `src/main/gitOps.ts`: `export function busyLabel(op: GitOp): string` (`Pushing…`, `Pulling…`, `Fetching…`, `Committing…`, `Switching…`, else `Working…`); `export class GitOps { constructor(ws: Workspace); run(repoPath: string, op: GitOp): Promise<OpResult>; fetchAll(): Promise<void>; branches(repoPath: string): Promise<{ ok: true; branches: string[]; current: string | null } | { ok: false; error: string }> }`. `run`: unknown repo → `{ ok: false, error: 'Unknown repository' }`; already busy → `Another operation is still running`; sets busy label, runs the op, refreshes the repo, clears busy. `commit` with `push: true` pushes only if the commit succeeded. `fetchAll` runs `fetch` on every non-busy repo in parallel.
- `commit()` in `src/git/actions.ts` keeps the full message (trim only trailing whitespace) and passes it with `-m` as one argv entry.
- Bridge adds `git(repoPath, op): Promise<OpResult>`, `fetchAll(): Promise<void>`, `branches(repoPath)`.
- Renderer: per-repo draft message and last error in the store. Commit box per `Main.dc.html` / `GitPaneli.dc.html`: textarea (placeholder `Commit message`), Cmd+Enter commits, button label from `commitTarget`, disabled when message blank or target disabled, the `Nothing is staged. This commits every change, new files included.` note in the commit-all state, caret menu with `Commit and push`. Draft clears on success. Error box: git's line, `Pull` button when the error contains `[rejected]` or `fetch first`, `Dismiss`. Busy: spinner + label on the row. Branch menu: list with current checked, `New branch…` inline input. Conflicts: `Open in Zed` is **not** built here (plan 2); the conflict note text is shown.
- Header buttons: fetch all, rescan. Test ids: `commit-message`, `commit-button`, `stage-file`, `unstage-file`, `stage-all`, `unstage-all`, `branch-button`, `error-box`.

- [ ] **Step 1: Write failing tests**
  - gitOps (temp repos + bare remote): `'an undiscovered repo path is rejected'` and `'a path containing .. is rejected'` (git log unchanged) (Review Focus 1); `'a second operation on the same repo is rejected, the first completes'` using a `pre-commit` hook that sleeps 1 s (Review Focus 2); `'commit and push in one operation'` (remote has the commit); `'push is not attempted if the commit fails'`; `'status refreshes and busy clears after an operation'`; `'fetchAll runs on every repo'`.
  - actions: `'a multi-line message starting with a dash and containing special characters is committed verbatim'` for `"-m fix: x\n\nbody with \"quotes\" and $(touch pwned)"` → `git log -1 --format=%B` equals it (plus newline) and no `pwned` file (Review Focus 4).
  - CommitBox (jsdom): disabled when empty; label switches between `Commit · 2 files` and `Commit all · 3 files`; Cmd+Enter calls `onCommit` with `{ all, push: false }`; `Commit and push` passes `push: true`.
  - e2e `'staging and committing returns the repo to clean'`: temp repo with one modified file → click `stage-file`, type message, click `commit-button` → row shows `✓` and `git log -1 --format=%s` in the temp repo equals the message.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: stage, commit, sync and switch branches from the Git tab`.

### Task 10: Waiting bell on Claude tabs

**Files:**
- Create: `src/main/claudeTitle.ts`, `tests/claudeTitle.test.ts`, `docs/notes/claude-terminal-title.md`
- Modify: `src/renderer/terminals/terminals.ts`, `src/renderer/terminals/TabBar.tsx`, `src/renderer/store.ts`

**Interfaces:**
- `export function claudeTitleState(title: string): 'waiting' | 'working' | null` — rule written from the recorded titles; `null` for titles that are not Claude Code's.
- The xterm `onTitleChange` of each tab feeds the rule; `Tab.waiting = tab.claude && state === 'waiting' && tab.id !== activeTab`. Becoming active clears it.

- [ ] **Step 1: Record.** With the probe at `scratchpad/probe/probe.cjs` extended to send one short prompt, record the OSC 0 titles Claude Code 2.1.331 emits at idle, while working, and on a permission prompt. Save the raw list to `docs/notes/claude-terminal-title.md`. If working and waiting titles cannot be told apart, stop here: ledger a ruling, remove the bell from the tab bar, and report it to the user (spec: "a bell that rings wrongly is worse than no bell at all").
- [ ] **Step 2: Write failing tests** from the recorded strings (each recorded title → expected state; a plain shell title → `null`).
- [ ] **Step 3:** Run `npm test`. Expected: FAIL.
- [ ] **Step 4:** Implement the rule and the yellow bell icon (`#E5C07B`, `aria-label="Needs input"`).
- [ ] **Step 5:** Run `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6:** Commit `feat: mark Claude tabs that are waiting for input`.

### Task 11: Resizable panels, close/quit guards, README, spike removal

**Files:**
- Create: `src/renderer/components/Splitter.tsx`, `tests/renderer/Splitter.test.tsx`, `README.md`
- Delete: `spike/electron-terminal/`
- Modify: `src/renderer/App.tsx`, `src/main/main.ts`, `src/main/ipc.ts`, `src/shared/api.ts`, `src/preload/preload.cts`

**Interfaces:**
- `export function clampWidths(o: { left: number; right: number; total: number }): { left: number; right: number }` — min left 320, min right 300; with no center panel the left takes `total - right`.
- Bridge adds `setLayout(patch: Partial<Layout>): void` (debounced save in main).
- Quit/close with a busy tab: `dialog.showMessageBox` `Quit edi?` / `N terminals still have a running process.` buttons `Quit`, `Cancel`.
- README: what edi is, `npm install && npm run setup`, `npm run dev`, `npm test`, `npm run e2e`, the safety rules list.

- [ ] **Step 1: Write failing tests** — `clampWidths` bounds; e2e `'right panel width is kept across relaunches'` (set layout through the bridge, relaunch with the same userData, read the panel width).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement; delete the spike.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: resizable panels and guards for running terminals`.
