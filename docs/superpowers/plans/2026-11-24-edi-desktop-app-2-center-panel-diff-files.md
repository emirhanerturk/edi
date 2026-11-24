# edi desktop app — plan 2: center panel, diff view, file view and the Files tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a changed file in the Git tab opens its diff in a center panel; the Files tab shows every repo's working tree and opens files read-only; both views can hand the file to Zed.

**Architecture:** The main process gains read-only "view" operations (diff text, file list, file content, open in Zed), each validated against the discovered repos and, for file paths, against the repo's own folder. The unified diff is parsed in `src/git` (no Electron). The renderer keeps the center panel's tabs in the zustand store, renders diffs and files with its own components, and colors code with Shiki (One Dark Pro, JavaScript regex engine, languages loaded on demand).

**Tech Stack:** as plan 1, plus `shiki` 4.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` (sections "Orta panel", "Files", "Yenileme"). Visual source: `docs/design/edi-ui/Main.dc.html`, `Dosyalar.dc.html`, `Collapsed.dc.html`.

This is plan 2 of 4. Not built here: the History tab and the commit view (plan 3), packaging (plan 4).

## Global Constraints

All of plan 1's constraints hold (forbidden git commands, nothing automatic, no network, sandboxed renderer, repo paths validated in main, temp dirs only in tests, English UI copy, Turkish code comments, Conventional Commits with the `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` footer). In addition:

- Everything added here is read-only on the repositories: `git diff`, `git ls-files`, reading a file. No new write path.
- A file path from the page is relative to a discovered repo and must resolve (after following symlinks) inside that repo's folder; anything else is refused before the file is opened.
- Files larger than 1 MB (1 048 576 bytes) and binary files (a NUL byte in the first 8 000 bytes) are never sent to the page.
- Shiki runs in the page with `createJavaScriptRegexEngine()`; no WebAssembly, no change to the CSP. Grammars and the theme are bundled, loaded with dynamic `import()`.
- Diff colors: added row `rgba(152,195,121,0.14)`, removed row `rgba(224,108,117,0.15)`, missing side `#23272E`, hunk header background `#2C313A` with `#56B6C2` text; rows are 22 px high, IBM Plex Mono 12 px; line-number column 40 px, marker column 22 px.
- Panel widths: left 492 px when the center panel is open (resizable, min 320), right 372 px (min 300), center takes the rest (min 360).

## Review Focus

1. A file path that leaves the repo (`../x`, an absolute path, a symlink pointing outside, a path through `.git`) is refused by `readRepoFile` and by `openInZed` without reading or opening anything. → Task 2 and Task 3 tests.
2. A binary file and a file over 1 MB come back as `{ kind: 'binary' }` / `{ kind: 'tooLarge' }` with no content. → Task 2 tests.
3. Diffs of files with spaces, a leading `-`, non-ASCII names, a rename, a deletion, and in a repo with no commits parse into the right rows and counts. → Task 1 and Task 3 tests.
4. Clicking file A and then file B before A's content arrives never shows A's content under B; switching folders closes every center tab. → Task 4 tests.
5. "Open in Zed" passes the path as an argument after the program's options and never through a shell; when every candidate fails the user sees an error. → Task 3 tests.

---

### Task 1: Parse unified diffs

**Files:** Create `src/git/diffParse.ts`, `tests/diffParse.test.ts`.

**Interfaces (produces):**

```ts
export type DiffLine =
  | { kind: 'context'; oldNo: number; newNo: number; text: string }
  | { kind: 'add'; newNo: number; text: string }
  | { kind: 'del'; oldNo: number; text: string };
export interface Hunk { header: string; lines: DiffLine[] }
export interface ParsedDiff { hunks: Hunk[]; added: number; removed: number; binary: boolean }
export function parseDiff(text: string): ParsedDiff;
export interface SplitRow { left: { no: number; text: string; changed: boolean } | null; right: { no: number; text: string; changed: boolean } | null }
export function splitRows(hunk: Hunk): SplitRow[];
```

- `parseDiff` skips the file header (`diff --git`, `index`, `---`, `+++`, mode and rename lines), reads `@@ -a,b +c,d @@ tail` (count defaults to 1), ignores `\ No newline at end of file`, sets `binary` on `Binary files … differ`, and returns empty hunks for empty input.
- `splitRows`: context lines fill both sides; inside a run of changes, the n-th removed line is paired with the n-th added line of the run that directly follows it; leftovers get `null` on the other side.

- [ ] **Step 1: failing tests** — the artboard's hunk (`-38,12 +38,16`) gives `added: 7, removed: 3` together with the second hunk and the split rows of `Main.dc.html` (line 43 removed with an empty right side; 46↔45 paired; 46–50 right-only); a header without counts (`@@ -1 +1 @@`); a new file (`--- /dev/null`), a deleted file, a rename with changes, `\ No newline` markers, CRLF content kept as text without the `\r`, a `Binary files` diff, the empty string, and a line that itself starts with `--- ` or `+++ ` inside a hunk (must be counted as a change, not as a header).
- [ ] **Step 2:** run `npx vitest run tests/diffParse.test.ts` — FAIL (module missing).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat(git): parse unified diffs into hunks and side-by-side rows`.

### Task 2: List and read working-tree files safely

**Files:** Create `src/git/files.ts`, `tests/files.test.ts`.

**Interfaces (produces):**

```ts
export type FileList = { ok: true; files: string[] } | { ok: false; error: string };
/** Tracked and untracked-but-not-ignored files that exist on disk, sorted, `/`-separated, relative to the repo. */
export function listFiles(repo: string): Promise<FileList>;
export type FileContent =
  | { ok: true; kind: 'text'; text: string; size: number }
  | { ok: true; kind: 'binary'; size: number }
  | { ok: true; kind: 'tooLarge'; size: number }
  | { ok: false; error: string };
export const MAX_FILE_BYTES = 1_048_576;
/** `null` when the path does not stay inside the repo. Does not touch the file system beyond realpath. */
export function resolveInRepo(repo: string, relPath: string): Promise<string | null>;
export function readRepoFile(repo: string, relPath: string): Promise<FileContent>;
```

- `listFiles`: `git ls-files -z --cached --others --exclude-standard`, de-duplicated, minus files deleted in the working tree (`git ls-files -z --deleted`).
- `resolveInRepo`: rejects empty, absolute, NUL-containing paths and any `..` segment; rejects a first segment `.git`; then `realpath` of the target must be the repo's realpath or under it (a missing file → `null`).
- `readRepoFile` errors: `File is outside the repository`, `File not found`, `Not a file`.

- [ ] **Step 1: failing tests** — list: tracked + untracked, ignored (`node_modules/x`, via `.gitignore`) absent, a deleted tracked file absent, names with spaces / non-ASCII / leading `-`, an unborn repo; read: text file, empty file (`text: ''`), exactly 1 048 576 bytes is text and one byte more is `tooLarge`, a PNG-like buffer with NUL is `binary`, a directory → `Not a file`, missing → `File not found`; escapes (Review Focus 1): `../outside.txt`, `/etc/hosts`, `a/../../outside.txt`, `.git/config`, a symlink `link -> ../outside.txt` and a symlinked directory pointing outside all give `File is outside the repository`, and a symlink pointing to a file inside the repo reads fine.
- [ ] **Step 2:** run the file — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat(git): list working-tree files and read them inside the repo only`.

### Task 3: View operations over the bridge, and Open in Zed

**Files:** Create `src/main/viewOps.ts`, `src/main/openInZed.ts`, `tests/viewOps.test.ts`, `tests/openInZed.test.ts`. Modify `src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/preload.cts`.

**Interfaces (produces):**

```ts
// shared/api.ts
export type DiffView = { ok: true; diff: ParsedDiff; file: FileChange } | { ok: false; error: string };
// EdiApi additions
diff(repoPath: string, filePath: string): Promise<DiffView>;
readFile(repoPath: string, filePath: string): Promise<FileContent>;
listFiles(repoPath: string): Promise<FileList>;
openInZed(repoPath: string, filePath: string | null): Promise<OpResult>;

// main/viewOps.ts
export class ViewOps {
  constructor(ws: Workspace, open?: (target: string) => Promise<OpResult>);
  diff(repoPath: unknown, filePath: unknown): Promise<DiffView>;
  readFile(repoPath: unknown, filePath: unknown): Promise<FileContent>;
  listFiles(repoPath: unknown): Promise<FileList>;
  openInZed(repoPath: unknown, filePath: unknown): Promise<OpResult>;
}
// main/openInZed.ts
export interface Launcher { command: string; args: (target: string) => string[] }
export function defaultLaunchers(env: NodeJS.ProcessEnv): Launcher[]; // zed <target>; /Applications/Zed.app/Contents/MacOS/cli <target>; open -a Zed <target>
export function openInZed(target: string, launchers?: Launcher[]): Promise<OpResult>; // ok message 'Opened in Zed'; all fail → 'Could not open Zed'
```

- `ViewOps.diff` looks the file up by path in a fresh `getStatus` (as stage/unstage do) and runs the existing `diffFile`; a path that is not a changed file → `File is not in the list of changes`. Unknown repo → `Unknown repository` everywhere.
- `openInZed(repoPath, null)` opens the repo folder; with a file path it goes through `resolveInRepo` first (a deleted file falls back to the repo folder). Launchers are tried in order with `execFile` (no shell, 5 s timeout); `open -a Zed` gets `--` is not supported by `open`, so the target is always an absolute path (never starts with `-`).

- [ ] **Step 1: failing tests** — `viewOps`: unknown repo / `..` repo path refused for all four calls; diff of a modified file returns hunks and the status record; diff for an untracked file works; diff in an unborn repo works; a file named `-weird name ö.txt` diffs; a path not in the status is refused; `readFile` and `openInZed` refuse `../x` (Review Focus 1) and the fake opener is not called; `openInZed(repo, null)` calls the opener with the repo path; a deleted file opens the repo folder. `openInZed`: launchers are tried in order (first fails with ENOENT, second succeeds → ok and the third is not run); all fail → `Could not open Zed`; the target is passed as one argv entry (a target containing spaces and `$(touch x)` reaches a recording script unchanged and nothing is executed).
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement; register `view:diff`, `view:read`, `view:list`, `view:openInZed`.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat: read-only view operations and Open in Zed over the bridge`.

### Task 4: Center panel shell and its tabs

**Files:** Create `src/renderer/center/tabs.ts`, `src/renderer/center/CenterPanel.tsx`, `src/renderer/center/center.css`, `tests/renderer/centerTabs.test.ts`, `tests/renderer/CenterPanel.test.tsx`. Modify `src/renderer/store.ts`, `src/renderer/App.tsx`, `src/renderer/components/Splitter.tsx`, `src/renderer/components/StatusBar.tsx`, `tests/renderer/Splitter.test.tsx`.

**Interfaces (produces):**

```ts
// center/tabs.ts — pure
export type CenterTarget = { kind: 'diff' | 'file'; repoPath: string; path: string };
export interface CenterTab extends CenterTarget { id: string; pinned: boolean }   // id = `${kind}:${repoPath}:${path}`
export interface CenterState { tabs: CenterTab[]; active: string | null; open: boolean }
export const EMPTY_CENTER: CenterState;
export function openTarget(s: CenterState, t: CenterTarget, pin: boolean): CenterState;
export function closeCenterTab(s: CenterState, id: string): CenterState;
export function activateCenterTab(s: CenterState, id: string): CenterState;
export function pinCenterTab(s: CenterState, id: string): CenterState;
export function setPanelOpen(s: CenterState, open: boolean): CenterState;
export function dropMissingRepos(s: CenterState, repoPaths: string[]): CenterState;
// Splitter.tsx
export function clampWidths(o: { left: number; right: number; total: number; center?: boolean }): { left: number; right: number };
```

- `openTarget`: an existing tab for the target is activated (and pinned when `pin`); otherwise an unpinned preview tab is replaced in place, or a new tab is appended; the panel opens. `closeCenterTab`: the right neighbour (else the left) becomes active; closing the last tab closes the panel. `setPanelOpen(false)` keeps the tabs; `setPanelOpen(true)` with no tabs stays closed.
- `clampWidths` with `center: true`: right ≥ 300, left ≥ 320, and `total - left - right ≥ 360` (the left gives way first, then the right, never below their minimums).
- Store: `center: CenterState`, `openInCenter(target, pin)`, `closeCenterTab`, `activateCenterTab`, `pinCenterTab`, `setCenterOpen`, `resizeLeft(left, total)`; a `workspace` event runs `dropMissingRepos`; a folder change resets the center.
- `CenterPanel`: tab strip (letter, name, muted folder; a preview tab's name is italic; close button on the active tab; "Close panel" at the right end), below it the active tab's view (Tasks 6 and 7 supply them; this task renders a placeholder with `data-testid="center-view"`). App layout: terminals `width: var(--left-width)` when the panel is open, `flex: 1` when it is closed; a second `Splitter` (`Resize the terminal panel`).

- [ ] **Step 1: failing tests** — reducers for every rule above, including: two single clicks reuse one preview tab; a double click pins and the next single click opens a second tab; clicking an open file switches to it; closing the panel and opening a target shows the old tabs again; `dropMissingRepos` removes tabs of a repo that disappeared and fixes `active`. `clampWidths` with a center. Component: tabs render, clicking a tab activates, the close buttons call back, a preview tab is marked `data-preview="true"`.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run e2e` — PASS.
- [ ] **Step 5:** commit `feat: center panel with preview and pinned tabs`.

### Task 5: Syntax colors

**Files:** Create `src/renderer/highlight/languages.ts`, `src/renderer/highlight/highlight.ts`, `tests/renderer/languages.test.ts`, `tests/renderer/highlight.test.ts`. Modify `package.json` (add `shiki`).

**Interfaces (produces):**

```ts
export function languageOf(path: string): { id: string; label: string } | null;   // 'play.tsx' → { id: 'tsx', label: 'TypeScript JSX' }
export interface Token { text: string; color: string }
/** One token list per line; `null` when the language is unknown or the text is longer than 200 000 characters. Never throws. */
export function highlightLines(text: string, path: string): Promise<Token[][] | null>;
```

- Languages: ts, tsx, js, jsx, mjs/cjs, json, jsonc, css, scss, html, md, mdx, yaml/yml, toml, sh/bash/zsh, py, rb, go, rs, swift, kt, java, c/h, cpp, sql, graphql, xml/svg/plist, dockerfile (`Dockerfile` by name), prisma, `.env*` as dotenv/ini, `Makefile`. Theme `one-dark-pro`. One highlighter instance, languages loaded on first use.

- [ ] **Step 1: failing tests** — `languageOf` table (extensions, `Dockerfile`, `.gitignore` → null, upper-case extension, no extension); `highlightLines('const a = 1;\n// x', 'a.ts')` gives two lines whose joined text equals the input lines and whose `const` token color differs from the comment's; unknown extension → `null`; an empty string → `[[]]` or one empty line; a 200 001-character text → `null`.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** `npm install shiki`, implement.
- [ ] **Step 4:** `npm run typecheck && npm test`; `npm run build` succeeds and `dist/renderer` contains no `.wasm`.
- [ ] **Step 5:** commit `feat: syntax colors with Shiki, loaded per language`.

### Task 6: Diff view

**Files:** Create `src/renderer/center/DiffView.tsx`, `src/renderer/center/useView.ts`, `tests/renderer/DiffView.test.tsx`. Modify `src/renderer/center/CenterPanel.tsx`, `src/renderer/center/center.css`, `src/renderer/git/GitPanelView.tsx`, `src/renderer/git/GitPanel.tsx`, `src/renderer/components/icons.tsx`, `e2e/center.spec.ts` (create).

**Interfaces:**

- `useView<T>(key: string, load: () => Promise<T>, refreshToken: unknown): { data: T | null; loading: boolean }` — loads when `key` changes, reloads silently when `refreshToken` changes, and drops a result whose key is no longer current (Review Focus 4).
- `DiffView` props: `{ repo: RepoView; path: string; mode: 'split' | 'inline'; onMode(mode): void; onOpenInZed(): void }`. It loads `edi.diff(repo.path, path)`, re-loading on every workspace snapshot (`workspace.refreshedAt`).
- Header: repo name, `/`, folder + file name, `+N −N`, `Split / Inline` group (`aria-pressed`), `Open in Zed`. Body: hunk headers and rows as the artboard; inline mode shows one column with both line numbers. An untracked file opens the file view instead (Task 7); a binary diff shows `Binary file — no diff to show` and `Open in Zed`; a file no longer changed shows `No changes left in this file`.
- Git tab: a single click on a file row calls `onOpenFile(repoPath, file, false)`, a double click pins; the selected row gets `aria-current="true"` and the artboard's selected style. Stage/unstage buttons keep working without opening the file.
- `layout.diffMode` is saved through `setLayout`.

- [ ] **Step 1: failing tests** — component (with a fake `edi`): split rows render with line numbers and `+`/`−` markers and the artboard's backgrounds; switching to Inline calls `onMode('inline')`; counts show; binary and "no changes left" states; e2e `'değişen dosyaya tıklayınca diff açılır'`: click `README.md` in the Git tab → center panel with one preview tab, `+1 −1`, the removed and added text visible; a second file reuses the tab; double click keeps both; `Close panel` hides it and clicking a file brings the tabs back; editing the file on disk updates the open diff within 5 s; the chosen mode survives a relaunch.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run e2e` — PASS; take a screenshot with a demo repo and compare with `Main.dc.html`.
- [ ] **Step 5:** commit `feat: open a file's diff from the Git tab`.

### Task 7: File view and the Files tab

**Files:** Create `src/renderer/center/FileView.tsx`, `src/renderer/files/tree.ts`, `src/renderer/files/FilesPanel.tsx`, `src/renderer/files/files.css`, `src/renderer/right/RightPanel.tsx`, `tests/renderer/tree.test.ts`, `tests/renderer/FileView.test.tsx`, `tests/renderer/FilesPanel.test.tsx`. Modify `src/renderer/App.tsx`, `src/renderer/git/GitPanelView.tsx` (header moves to `RightPanel`), `src/renderer/store.ts`, `src/renderer/components/StatusBar.tsx`, `e2e/center.spec.ts`.

**Interfaces:**

```ts
// files/tree.ts — pure
export interface TreeNode { name: string; path: string; kind: 'dir' | 'file'; children: TreeNode[]; letter: string | null; dirty: boolean }
export function buildTree(files: string[], changes: FileChange[]): TreeNode[];          // folders first, then files, each by name (case-insensitive)
export interface TreeRow { node: TreeNode; depth: number; open: boolean }
export function flattenTree(nodes: TreeNode[], isOpen: (path: string) => boolean, depth?: number): TreeRow[];
```

- `RightPanel`: tabs `Git` (badge) and `Files`; the header buttons depend on the tab (Git: fetch all, rescan; Files: collapse all). The History tab arrives with plan 3 and is not shown.
- `FilesPanel`: one top-level folder per repo (open by default when it is the only repo — then its content is shown directly, without the repo row); folders closed by default; a changed file shows its status letter in its color, a folder containing changes shows `●` in yellow; the selected file has the selected style. File lists are loaded per repo when its folder is first opened and re-loaded when the repo's set of changed paths changes or on Rescan. Click opens the file view (preview), double click pins.
- `FileView` props `{ repo: RepoView; path: string; onOpenInZed(): void }`: header (repo, path, `new file` chip when the file is untracked, `Read-only`, `Open in Zed`); body with line numbers (48 px column) and colors; `This file is too large to show (N MB)` / `Binary file` / `File not found` notes with `Open in Zed`.
- Status bar, right side: file view → `<Language> · N lines`; diff view → `+N −N`; otherwise the refresh text.
- Conflicted files in the Git tab get an `Open in Zed` icon button (spec: "her dosyada Open in Zed").

- [ ] **Step 1: failing tests** — `buildTree`/`flattenTree`: nesting, order, letters from the status, `dirty` propagation, a deleted file is not listed, open/closed folders; `FileView`: lines and numbers, chip for an untracked file, the three notes; `FilesPanel`: single-repo root, collapse all, markers; e2e `'Files sekmesinden dosya açılır'`: switch to Files, open folders, click a file → file view with its text and `Read-only`; an untracked file clicked in the Git tab opens the file view with `new file`; a 2 MB file shows the too-large note; the status bar shows the language and line count.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run e2e` — PASS; screenshot against `Dosyalar.dc.html`.
- [ ] **Step 5:** commit `feat: Files tab and a read-only file view`.

### Task 8: README and loose ends

**Files:** Modify `README.md`.

- [ ] **Step 1:** update "What it does today" (diff view, file view, Files tab, Open in Zed) and the "planned next" line; add the read-only rule for file access to the safety list.
- [ ] **Step 2:** `npm run typecheck && npm test && npm run e2e` — PASS.
- [ ] **Step 3:** commit `docs: describe the center panel and the Files tab`.
