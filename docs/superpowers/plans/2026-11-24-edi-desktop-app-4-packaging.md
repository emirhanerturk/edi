# Packaging, Icon and the `edi` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an unsigned (ad-hoc) `edi.app` with `npm run dist` and install it to `/Applications`, open folders with the `~/.local/bin/edi` command, and use the login shell's environment when launched from the Dock.

**Architecture:** Packaging uses `@electron/packager` (`scripts/dist.mjs`); install decisions live in pure helpers (`scripts/install.mjs`) and are tested. The command is a small sh script in the app's `Resources` folder; it starts a second instance with `open -n -a`, and that instance hits the single-instance lock and hands the folder over to the first instance (`second-instance`). The login shell's environment is read once at startup by `src/main/loginEnv.ts`.

**Tech Stack:** Electron 45, @electron/packager 20.3.0, macOS `codesign`, `sips`, `iconutil`, `ditto`.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` → "Technical decisions / Packaging", "Later additions" (`edi <path>`, App icon, Login shell environment).

## Global Constraints

- No signing, notarization or auto-update; an ad-hoc signature (`codesign -s -`) only so the app can open on arm64.
- The app does not go out to the network. The user's `~/.claude/settings.json` is not touched.
- Install: `/Applications/edi.app` and `~/.local/bin/edi`; no install while edi is running; an `edi.app` or `~/.local/bin/edi` that does not belong to edi is never overwritten.
- `edi <path>`: error if it is not a folder; if the app is running, the same window switches to that folder (with the "Switch folders?" question when a terminal is running); with no path, the last folder.
- Tests do not touch `/Applications` or `~/.local/bin`; install targets are parameters.
- UI copy is English, code comments and test names are Turkish.

## Review Focus

1. A login shell with a slow, failing or noisy `.zshrc` (nvm, oh-my-zsh, `echo`): startup must not hang and the environment must not be corrupted.
2. `edi` given a file, a path that does not exist, or a folder with spaces / Turkish characters / a leading `-`: the right folder or a clear error.
3. `edi ../x` while edi is running: not a new window, but the same window and its question; a minimized window comes to the front.
4. In the packaged app, node-pty (`spawn-helper` outside the asar), Shiki language files and fonts work.
5. Running `npm run dist` a second time (an update) and running it while `/Applications/edi.app` is open.

---

### Task 1: Login shell environment

**Files:** Create `src/main/loginEnv.ts`; Modify `src/main/main.ts`; Test `tests/loginEnv.test.ts`

**Interfaces:**
- `parseEnvBlock(out: string, marker: string): Record<string, string> | null` — the `env -0` output between the two markers; null when the marker is missing.
- `readLoginEnv(shell: string, opts?: { timeoutMs?: number }): Promise<Record<string, string> | null>` — `shell -ilc 'printf %s M; env -0; printf %s M'`, stdin closed, default 10 s; null on error/timeout.
- `mergeLoginEnv(base: NodeJS.ProcessEnv, login: Record<string,string>): NodeJS.ProcessEnv` — login values are added/override; `PWD`, `OLDPWD`, `SHLVL`, `_` and `ELECTRON_*`, `EDI_*` are not taken.

- [ ] Tests: noisy output (text before/after the marker, `=` and a newline inside a value); null when the marker is missing; `readLoginEnv` with a fake "shell" script (in a temp dir, ignores its flags and prints the same format); with a fake shell that sleeps 1 s, `timeoutMs: 200` → null and takes less than 1 s; the exclusions of `mergeLoginEnv`.
- [ ] See FAIL, write, PASS.
- [ ] `main.ts`: when `app.isPackaged`, apply it to `process.env` inside `whenReady` before `AppCore.create`. Shell: `process.env.SHELL || os.userInfo().shell || '/bin/zsh'`.
- [ ] `npm test`, typecheck. Commit `feat(main): take the login shell's environment when packaged`.

### Task 2: Folder argument, single instance and the `edi` script

**Files:** Create `src/main/args.ts`, `resources/edi` (sh script, executable); Modify `src/main/main.ts`, `src/main/ipc.ts` (for `focus` if needed); Test `tests/args.test.ts`, `tests/launcher.test.ts`

**Interfaces:**
- `folderArg(argv: string[]): string | undefined` — the absolute path after the `--open` flag; undefined when missing or relative.
- Script `resources/edi`: `EDI_APP` (default `/Applications/edi.app`). No argument: `open -a "$EDI_APP"`. With an argument: absolute path via `cd -- "$1"` and `pwd -P`; if it is not a folder, stderr `edi: not a folder: <arg>`, exit 1; then `open -n -a "$EDI_APP" --args --open "<path>"`. More than one argument: `usage: edi [folder]`, exit 2.
- `main.ts`: `app.requestSingleInstanceLock()`; if it cannot be taken, `app.quit()`. `second-instance` → if `folderArg(argv)` is set, `core.openFolder(dir)`; show the window / bring it to the front. First launch: `folderArg(process.argv) ?? process.env.EDI_OPEN_DIR`.
- When running unpackaged (`!app.isPackaged` and no `EDI_USER_DATA`), userData becomes `edi-dev`, so the development copy does not hit the installed app's lock.

- [ ] Tests: `folderArg` (`--open /a b/ç`, relative path, no flag, flag at the end); script: put a fake `open` (writes its arguments to a file) at the front of PATH and run `sh resources/edi`, `edi .`, `edi "boş luk"`, not `edi -- -tire` but `edi ./-tire`, file → error 1, nonexistent → error 1, two arguments → 2, no argument → `-a`.
- [ ] See FAIL, write, PASS. `npm test`, typecheck, `npm run e2e` (the single-instance lock must not break e2e). Commit `feat(main): open a folder passed by the edi command`.

### Task 3: Icon

**Files:** Create `scripts/make-icon.mjs`, `build/icon.icns`; Modify `package.json` (`"icon": "electron scripts/make-icon.mjs"`)

- [ ] `scripts/make-icon.mjs` runs with Electron: it draws `docs/design/icon/wordmark.svg` at 1024×1024 in a transparent, hidden window, with `@fontsource/ibm-plex-mono` weight 600 embedded via `@font-face`, then `capturePage` → PNG; iconset sizes (16…1024, @2x) with `sips -z`, `iconutil -c icns` → `build/icon.icns`. Temp files go in `os.tmpdir()`.
- [ ] Run it; open it back up with `sips -g pixelWidth` and `iconutil -c iconset` and look at the 1024 PNG (is the text IBM Plex Mono?). Commit `build: generate the app icon from the wordmark`.

### Task 4: Packaging and install

**Files:** Create `scripts/dist.mjs`, `scripts/install.mjs`; Modify `package.json` (`dist`, `@electron/packager` 20.3.0 as dev, `react`/`shiki` moved to devDependencies), `playwright.config.ts` (a separate project for the packaged app), `README.md`; Test `tests/install.test.ts`, `e2e-dist/packaged.spec.ts`

**Interfaces (`scripts/install.mjs`):**
- `BUNDLE_ID = 'dev.edi.app'`
- `checkTarget(appPath: string): Promise<'missing' | 'ours' | 'foreign'>` — the `CFBundleIdentifier` in `Contents/Info.plist` (`plutil -extract … raw`).
- `checkLink(linkPath: string, target: string): Promise<'missing' | 'ours' | 'foreign'>` — our link: a symlink pointing to `target`.
- `isRunning(appPath: string): Promise<boolean>` — `pgrep -f <appPath>/Contents/MacOS/`.
- `install({ built, appPath, linkPath }): Promise<string[]>` — in order: if running, error "Quit edi before installing"; if foreign, error; delete the old `ours` copy and `ditto built appPath`; if there is no link, create it, if `ours` leave it alone, if foreign, error. Returns: lines describing what was done.

**`scripts/dist.mjs`:** `npm run build` → packager (`name: 'edi'`, `appBundleId: BUNDLE_ID`, `icon: build/icon.icns`, `out: release`, `asar: { unpack: '**/node_modules/node-pty/**' }`, `extraResource: ['resources/edi']`, `ignore`: only `/dist`, `/package.json`, `/node_modules` stay, `overwrite: true`) → `codesign --force --deep -s -` → `install` unless `--no-install`. Output lines are in English.

- [ ] Tests (`tests/install.test.ts`, fake `.app`s in a temp dir): missing/ours/foreign; a foreign app and a foreign link give an error and nothing is deleted; ours is updated (the old file goes, the new one arrives); the link is created and does not change on a second run; error while a copy is running (fake `isRunning`).
- [ ] See FAIL, write, PASS.
- [ ] `npm run dist -- --no-install`; `e2e-dist/packaged.spec.ts` (`_electron.launch({ executablePath: release/…/edi.app/Contents/MacOS/edi })`, temp `EDI_USER_DATA`, `--open <temp repo>`): the repo shows, `echo` runs in the terminal (node-pty), an opened file is colored (Shiki). An `npm run e2e:dist` script.
- [ ] README: an Install section (`npm run dist`, what it installs, `edi .`). `npm test`, typecheck, `npm run e2e`, `npm run e2e:dist`. Commit `build: package and install edi with npm run dist`.
- [ ] The install on the user's machine (the real `/Applications` and `~/.local/bin`) is started by the **user** or explicitly requested by them; the executor does not run it.
