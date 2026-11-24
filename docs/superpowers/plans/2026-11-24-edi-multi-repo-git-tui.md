# edi — multi-repo git TUI Implementation Plan

> **Note (2026-11-24):** The interface part of this document (the Ink TUI) was cancelled;
> it was replaced by `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md`. The
> parts about the git core still apply.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the `edi` command, which shows the live status of every git repo in a folder on a single terminal screen and lets you stage/commit/push/pull/fetch/branch/diff from there.

**Architecture:** Three layers. (1) `src/git/*`: a pure Node layer that runs the `git` CLI with an argument array and never throws an exception. (2) `src/ui/rows.ts`: pure functions that produce the on-screen row list, the cursor and the scroll window from repo statuses. (3) `src/ui/*.tsx`: Ink components; a hook that polls status, and mode-based key handling.

**Tech Stack:** Node ≥ 22 (24 on the machine), TypeScript (ESM, NodeNext), Ink 8 + React 19, Vitest, ink-testing-library, tsx. No git library.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-multi-repo-git-tui-design.md`

## Global Constraints

- The only runtime dependencies are `ink` and `react`. Versions are taken at their latest with `npm install`.
- Every git call goes through `runGit(cwd, args[])`; no shell string, file paths always after `--`.
- These commands/flags appear nowhere in the code: `reset --hard`, `checkout -- <path>`, `clean`, `push --force*`, `rebase`, `--no-verify`, `fetch --prune`. (`git reset -q -- <path>` touches only the index and is allowed.)
- No automatic fetch/pull/push; only by key press.
- UI copy is Turkish and exactly as written in this plan/the spec.
- Tests run only in temp dirs; they do not touch the real repos under `~/studios` or real remotes (a local bare repo serves as the remote).
- Commits follow Conventional Commits 1.0.0; every commit message ends with the footer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **A repo with no commits at all:** the branch name shows; unstage and diff do not fail. → Task 2, Task 3.
2. **Paths with spaces/Turkish characters and a staged rename:** parsed correctly; stage, unstage and diff work. → Task 2, Task 3.
3. **A repo deleted or corrupted while running:** only that row shows an error, the others keep refreshing, the app does not crash. → Task 5.
4. **Pressing a key while another git process has locked the index (`index.lock`) or while an operation is running on the same repo:** the error shows on the row, the second operation is not queued, polling continues. → Task 3, Task 5, Task 6.
5. **A very small terminal, a list that does not fit, a diff thousands of lines long:** only the visible window is drawn, the cursor stays visible. → Task 4, Task 8.

---

### Task 1: Project scaffold, `runGit`, repo discovery

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/git/exec.ts`, `src/git/discover.ts`
- Test: `tests/helpers/tmpRepo.ts`, `tests/exec.test.ts`, `tests/discover.test.ts`

**Interfaces:**
- Produces:

```ts
// src/git/exec.ts
export type GitResult = { ok: true; stdout: string } | { ok: false; error: string; stdout: string };
export function runGit(cwd: string, args: string[], opts?: { timeoutMs?: number; okCodes?: number[] }): Promise<GitResult>;
export function pickErrorLine(stderr: string): string;
// src/git/discover.ts
export interface Repo { name: string; path: string }
export function discoverRepos(dir: string): Promise<Repo[]>;
// tests/helpers/tmpRepo.ts
export function makeTmpDir(): Promise<string>;   // realpath'd; deleted in afterEach
export function initRepo(parent: string, name: string, opts?: { commit?: boolean }): Promise<string>; // branch main, local user.name/email; if commit:true, a first commit with README
export function git(cwd: string, ...args: string[]): Promise<string>;  // throws on non-zero exit
export function addBareRemote(repoPath: string): Promise<string>;     // creates a bare repo, adds it as origin, returns its path
```

- [ ] **Step 1: Set up the scaffold.** `package.json`: `"name": "edi"`, `"private": true`, `"type": "module"`, `"bin": { "edi": "dist/cli.js" }`, `"engines": { "node": ">=22" }`, scripts: `build` = `tsc`, `dev` = `tsx src/cli.tsx`, `test` = `vitest run`, `typecheck` = `tsc --noEmit`. `tsconfig.json`: `module`/`moduleResolution` `NodeNext`, `jsx` `react-jsx`, `strict`, `outDir` `dist`, `rootDir` `src`. `.gitignore`: `node_modules`, `dist`. Run: `npm install ink react && npm install -D typescript tsx vitest ink-testing-library @types/react @types/node`.

- [ ] **Step 2: Write the failing tests** (`tests/exec.test.ts`, `tests/discover.test.ts`):

```ts
it('runGit success', async () => expect(await runGit(repo, ['rev-parse', '--is-inside-work-tree'])).toEqual({ ok: true, stdout: 'true\n' }));
it('runGit in a non-repo dir', async () => { const r = await runGit(plainDir, ['status']); expect(r.ok).toBe(false); expect(!r.ok && r.error).toMatch(/^fatal:/); });
it('runGit with a missing cwd does not throw', async () => expect((await runGit('/yok/boyle/yer', ['status'])).ok).toBe(false));
it('runGit okCodes', async () => expect((await runGit(repo, ['diff', '--no-index', '--', '/dev/null', 'README.md'], { okCodes: [0, 1] })).ok).toBe(true));
it('pickErrorLine', () => {
  expect(pickErrorLine('hint: x\nerror: failed to push some refs\n')).toBe('error: failed to push some refs');
  expect(pickErrorLine(' ! [rejected] main -> main (fetch first)\nerror: failed\n')).toBe('! [rejected] main -> main (fetch first)');
  expect(pickErrorLine('foo\nbar\n')).toBe('bar');
  expect(pickErrorLine('')).toBe('git başarısız oldu');
});
// discover: inside parent, a (repo), b (plain folder), c (folder with a .git FILE), dosya.txt
it('lists the repos one level down by name', async () => expect((await discoverRepos(parent)).map(r => r.name)).toEqual(['a', 'c']));
it('returns only the folder itself when it is a repo', async () => expect(await discoverRepos(repoA)).toEqual([{ name: 'a', path: repoA }]));
it('empty when there are no repos', async () => expect(await discoverRepos(emptyDir)).toEqual([]));
```

- [ ] **Step 3: See the tests fail.** Run: `npm test` → FAIL (modules missing).

- [ ] **Step 4: Write `runGit` and `pickErrorLine`.** `spawn('git', args, { cwd, detached: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })`. `detached` cuts off the controlling terminal; that way ssh/git cannot take over the terminal to ask for a password and fails fast instead. Default `timeoutMs` 15000; when exceeded, kill the process group, `error: 'zaman aşımı'`. It never rejects, spawn errors included. `pickErrorLine`: the first (trimmed) line that starts with `fatal:` / `error:` or contains `[rejected]`; otherwise the last non-empty line; if there is none, `'git başarısız oldu'`.

- [ ] **Step 5: Write `discoverRepos`.** If `dir/.git` exists, `[{ name: basename(dir), path: dir }]`; otherwise the direct subfolders that contain `.git` (file or directory), sorted by `name` with `localeCompare`. An unreadable subfolder is skipped.

- [ ] **Step 6: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.

- [ ] **Step 7: Commit.** `git add -A && git commit` — `build: scaffold project with git exec and repo discovery`

---

### Task 2: Reading and parsing status

**Files:**
- Create: `src/git/status.ts`
- Test: `tests/status.test.ts`

**Interfaces:**
- Consumes: `runGit`, `GitResult` (Task 1).
- Produces:

```ts
export interface FileChange { path: string; origPath: string | null; x: string; y: string; kind: 'changed' | 'untracked' | 'conflicted' }
export interface RepoStatus { head: string; detached: boolean; unborn: boolean; upstream: string | null; ahead: number | null; behind: number | null; files: FileChange[] }
export function parseStatus(raw: string): RepoStatus;
export function getStatus(repoPath: string): Promise<{ ok: true; status: RepoStatus } | { ok: false; error: string }>;
export function isStaged(f: FileChange): boolean;     // kind === 'changed' && x !== '.'
export function hasUnstaged(f: FileChange): boolean;  // kind === 'untracked' || (kind === 'changed' && y !== '.')
export function isDeleted(f: FileChange): boolean;    // y === 'D' || (y === '.' && x === 'D')
export function statusLetter(f: FileChange): string;  // untracked '?', conflicted 'U', otherwise y !== '.' ? y : x
export function statusTag(f: FileChange): '' | '[staged]' | '[kısmen]';
```

- [ ] **Step 1: Write the failing tests.** Fixtures come from real NUL-separated output (`H` = any 40-character hash):

```ts
const hdr = '# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head main\0';
it('upstream and ahead/behind', () => expect(parseStatus(hdr + '# branch.upstream origin/main\0# branch.ab +1 -2\0')).toMatchObject({ head: 'main', upstream: 'origin/main', ahead: 1, behind: 2, files: [] }));
it('no upstream', () => expect(parseStatus(hdr)).toMatchObject({ upstream: null, ahead: null, behind: null }));
it('detached', () => expect(parseStatus('# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head (detached)\0')).toMatchObject({ head: 'c8be86c', detached: true }));
it('no commits', () => expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ head: 'main', unborn: true }));
it('a rename record consumes the origPath field', () => {
  const s = parseStatus(hdr + `2 R. N... 100644 100644 100644 ${H} ${H} R100 yeni.txt\0boş dosya.txt\0? unt.txt\0`);
  expect(s.files).toEqual([
    { path: 'yeni.txt', origPath: 'boş dosya.txt', x: 'R', y: '.', kind: 'changed' },
    { path: 'unt.txt', origPath: null, x: '?', y: '?', kind: 'untracked' },
  ]);
});
it('path with spaces', () => expect(parseStatus(hdr + `1 .M N... 100644 100644 100644 ${H} ${H} a b/c d.txt\0`).files[0].path).toBe('a b/c d.txt'));
it('conflict', () => expect(parseStatus(hdr + `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} x.txt\0`).files[0]).toMatchObject({ path: 'x.txt', kind: 'conflicted' }));
it('letter and tag', () => {
  const f = (x: string, y: string, kind: FileChange['kind'] = 'changed') => ({ path: 'p', origPath: null, x, y, kind });
  expect([statusLetter(f('.', 'M')), statusTag(f('.', 'M'))]).toEqual(['M', '']);
  expect([statusLetter(f('M', '.')), statusTag(f('M', '.'))]).toEqual(['M', '[staged]']);
  expect([statusLetter(f('A', 'M')), statusTag(f('A', 'M'))]).toEqual(['M', '[kısmen]']);
  expect(statusLetter(f('?', '?', 'untracked'))).toBe('?');
  expect(statusLetter(f('U', 'U', 'conflicted'))).toBe('U');
});
// real repo
it('getStatus lists new files one by one', async () => { /* create d/n.txt and "boş dosya.txt" */ expect(paths).toEqual(['boş dosya.txt', 'd/n.txt']); });
it('getStatus works in a repo with no commits', async () => expect(r.ok && r.status.unborn).toBe(true));
it('getStatus ok:false on a missing path', async () => expect((await getStatus('/yok')).ok).toBe(false));
```

- [ ] **Step 2: See it fail.** Run: `npx vitest run tests/status.test.ts` → FAIL.

- [ ] **Step 3: Write `parseStatus` and the helpers.** Records are separated by NUL. Path: everything after the 8th space in type `1`, the 9th in type `2`, the 10th in type `u`. The NUL field after type `2` is `origPath`. `!` records are skipped. When detached, `head` = the first 7 characters of `branch.oid`. Without `branch.ab`, `ahead`/`behind` are `null`.

- [ ] **Step 4: Write `getStatus`.** Command: `git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=all`.

- [ ] **Step 5: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.

- [ ] **Step 6: Commit.** `feat: read and parse repository status`

---

### Task 3: Git operations

**Files:**
- Create: `src/git/actions.ts`
- Test: `tests/actions.test.ts`

**Interfaces:**
- Consumes: `runGit` (Task 1); `FileChange`, `RepoStatus`, `getStatus` (Task 2).
- Produces:

```ts
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
export type DiffResult = { ok: true; text: string } | { ok: false; error: string };
export function stageFile(repo: string, f: FileChange): Promise<ActionResult>;   // git add -A -- <path>
export function unstageFile(repo: string, f: FileChange): Promise<ActionResult>; // git reset -q -- <path> [origPath]
export function stageAll(repo: string): Promise<ActionResult>;                   // git add -A
export function unstageAll(repo: string): Promise<ActionResult>;                 // git reset -q
export function commit(repo: string, message: string, opts: { addAll: boolean }): Promise<ActionResult>;
export function push(repo: string, status: RepoStatus): Promise<ActionResult>;
export function pull(repo: string): Promise<ActionResult>;                       // git pull --ff-only
export function fetchRepo(repo: string): Promise<ActionResult>;                  // git fetch
export function listBranches(repo: string): Promise<{ ok: true; branches: string[]; current: string | null } | { ok: false; error: string }>;
export function switchBranch(repo: string, name: string): Promise<ActionResult>; // git switch <name>
export function createBranch(repo: string, name: string): Promise<ActionResult>; // git switch -c <name>
export function diffFile(repo: string, status: RepoStatus, f: FileChange): Promise<DiffResult>;
export function diffRepo(repo: string, status: RepoStatus): Promise<DiffResult>;
```

Constants: `commit` with an empty/whitespace message returns `{ ok: false, error: 'commit mesajı boş' }` without calling git; with `addAll`, first `git add -A`; then `git commit -m <message>`, timeout 120000 (hooks can be slow). `push`: if `status.detached`, `{ ok: false, error: 'detached HEAD: push edilemez' }`; if `status.upstream === null`, `git push -u origin <head>`, otherwise `git push`. Timeout 60000 for network commands (`push`/`pull`/`fetch`). `listBranches`: `git for-each-ref --format=%(refname:short) refs/heads` + `git symbolic-ref --short -q HEAD`. Diff base: `status.unborn ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' : 'HEAD'`; `--no-color --no-ext-diff -M` on every diff. New file: `git diff --no-color --no-index -- /dev/null <path>` (`okCodes: [0, 1]`). `diffRepo` = the diff against the base followed by the diff of each new file.

- [ ] **Step 1: Write the failing tests.** Each in a temp repo; status is verified with `getStatus`, history with the `git(...)` helper:

```ts
it('stage/unstage a file ("boş dosya.txt")');            // x: '.'→'A'→ untracked again
it('unstage works in a repo with no commits');           // ok: true, the file is untracked again
it('unstaging a staged rename leaves no staged record'); // files.every(f => !isStaged(f))
it('stageAll / unstageAll');
it('commit takes only the staged files');                // log -1 %s === 'feat: x'; the other file is still ' M'
it('commit addAll takes the new file too');              // status.files.length === 0
it('an empty message does not commit');                  // error 'commit mesajı boş', rev-list --count unchanged
it('ok:false when there is nothing to commit');
it('a rejecting pre-commit hook: ok:false, HEAD unchanged'); // .git/hooks/pre-commit: echo "lint failed" >&2; exit 1
it('with index.lock present, stageFile ok:false, getStatus ok:true'); // 'index.lock' in the error
it('push without upstream goes to origin with -u');      // afterwards status.upstream === 'origin/main', ahead 0
it('push ok:false when there is no origin'); it('detached push ok:false');
it('pull fast-forwards');                                // a second clone pushes; after pull HEAD === origin/main
it('pull on diverged history ok:false, HEAD unchanged');
it('behind 1 after fetch');
it('listBranches', async () => expect(r).toEqual({ ok: true, branches: ['feat/x', 'main'], current: 'main' }));
it('switchBranch / createBranch');                       // status.head
it('switch with conflicting changes ok:false, branch unchanged');
it('diffFile on a changed file', async () => expect(text).toContain('+yeni satır'));
it('diffFile on a new file', async () => expect(text).toContain('+++ b/unt.txt'));
it('diffFile on a staged file in a repo with no commits', async () => expect(r.ok).toBe(true));
it('diffRepo gives tracked and new files together');
it('diff is plain text with color.ui=always and diff.external set', async () => expect(text).not.toContain('\u001B['));
```

- [ ] **Step 2: See it fail.** Run: `npx vitest run tests/actions.test.ts` → FAIL.
- [ ] **Step 3: Write `src/git/actions.ts` with the signatures and constants above.** Success messages are short Turkish: `'stage edildi'`, `'unstage edildi'`, `'commit edildi'`, `'push edildi'`, `'pull edildi'`, `'fetch edildi'`, `'<name> branch'ine geçildi'`. Error = `runGit`'s `error`.
- [ ] **Step 4: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Forbidden command scan.** Run: `grep -rnE "reset --hard|--force|--no-verify|--prune|'clean'|'rebase'" src/` → no output.
- [ ] **Step 6: Commit.** `feat: add stage, commit, sync, branch and diff operations`

---

### Task 4: Row model (pure)

**Files:**
- Create: `src/ui/rows.ts`
- Test: `tests/rows.test.ts`

**Interfaces:**
- Consumes: `Repo` (Task 1); `RepoStatus`, `FileChange` (Task 2).
- Produces:

```ts
export interface RepoState { status: RepoStatus | null; error: string | null; busy: string | null }
export type Row =
  | { type: 'repo'; key: string; repo: Repo; state: RepoState; expanded: boolean }
  | { type: 'file'; key: string; repo: Repo; file: FileChange };
export function buildRows(repos: Repo[], states: Record<string, RepoState>, overrides: Record<string, boolean>): Row[];
export function resolveCursor(rows: Row[], prevKey: string | null, prevIndex: number): number;
export function windowTop(count: number, cursor: number, height: number, prevTop: number): number;
export function repoSummary(state: RepoState): { branch: string; sync: string; changes: string };
```

Rules: repo row `key` = `repo.path`; file row `key` = `repo.path + '\0' + file.path`. `expanded` = `overrides[repo.path] ?? (file count > 0)`. `resolveCursor`: the index of `prevKey` if it still exists; otherwise clamp `prevIndex` to `[0, rows.length - 1]`. `windowTop`: if the cursor is inside the window, `prevTop` is kept, otherwise the minimal scroll; `height < 1` → counts as 1; the result is in `[0, max(0, count - height)]`. `repoSummary`: if `status === null`, `changes` = `'! ' + error` when there is an error, otherwise `'yükleniyor…'`; `branch` = `status.head`; `sync` = `''` when detached, `'upstream yok'` when there is no upstream, otherwise `'↓2 ↑1'` with the non-zero ones (`''` when both are 0); `changes` = `busy ?? (n > 0 ? '● n değişiklik' : '✓ temiz')`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('a clean repo comes closed, a repo with changes open'); // row types: ['repo','repo','file','file']
it('an override beats the default');                      // { [dirty.path]: false } → no file rows
it('resolveCursor follows the key');                      // stays on the same file when a row is inserted before it
it('resolveCursor clamps when the key disappears', () => expect(resolveCursor(rows3, 'yok', 9)).toBe(2));
it('windowTop', () => {
  expect(windowTop(100, 99, 3, 0)).toBe(97);
  expect(windowTop(100, 5, 10, 2)).toBe(2);
  expect(windowTop(100, 1, 10, 2)).toBe(1);
  expect(windowTop(3, 2, 10, 0)).toBe(0);
  expect(windowTop(100, 7, 0, 0)).toBe(7);
});
it('repoSummary', () => {
  expect(repoSummary(st({ head: 'main', upstream: 'origin/main', ahead: 1, behind: 2, files: [f, f, f] }))).toEqual({ branch: 'main', sync: '↓2 ↑1', changes: '● 3 değişiklik' });
  expect(repoSummary(st({ upstream: null, ahead: null, behind: null })).sync).toBe('upstream yok');
  expect(repoSummary(st({ upstream: 'origin/main', ahead: 0, behind: 0 }))).toMatchObject({ sync: '', changes: '✓ temiz' });
  expect(repoSummary({ status: null, error: 'fatal: not a git repository', busy: null }).changes).toBe('! fatal: not a git repository');
  expect(repoSummary({ ...st({}), busy: 'push ediliyor…' }).changes).toBe('push ediliyor…');
});
```

- [ ] **Step 2: See it fail.** Run: `npx vitest run tests/rows.test.ts` → FAIL.
- [ ] **Step 3: Write `src/ui/rows.ts`.**
- [ ] **Step 4: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat: add row model, cursor tracking and scroll window`

---

### Task 5: App shell — list, polling, navigation, opening in Zed

**Files:**
- Create: `src/cli.tsx`, `src/ui/App.tsx`, `src/ui/useRepos.ts`, `src/ui/RepoList.tsx`, `src/zed.ts`
- Test: `tests/helpers/ui.ts`, `tests/app-shell.test.tsx`, `tests/useRepos.test.tsx`, `tests/zed.test.ts`

**Interfaces:**
- Consumes: `discoverRepos`, `Repo` (Task 1); `getStatus`, `isDeleted`, `statusLetter`, `statusTag` (Task 2); `ActionResult` (Task 3); all of Task 4.
- Produces:

```ts
// src/zed.ts
export function zedCandidates(file: string, zedOnPath: boolean): { cmd: string; args: string[] }[];
export function openInZed(file: string): Promise<ActionResult>;
// src/ui/useRepos.ts
export function useRepos(dir: string, pollMs: number): {
  repos: Repo[]; states: Record<string, RepoState>; lastRefresh: number | null;
  rescan(): Promise<void>; refresh(repoPath: string): Promise<void>;
  runAction(repo: Repo, busyLabel: string, fn: () => Promise<ActionResult>): Promise<ActionResult>;
};
// src/ui/App.tsx
export type Mode = { kind: 'list' };   // later tasks extend this union
export interface AppProps { dir: string; pollMs?: number; openFile?: (absPath: string) => Promise<ActionResult> }
export function App(props: AppProps): React.JSX.Element;
// tests/helpers/ui.ts
export function waitFor(check: () => boolean, timeoutMs?: number): Promise<void>;  // default 3000; throws when time runs out
export const keys: { up: string; down: string; enter: string; esc: string; space: string };
```

Constants:
- `useRepos`: per repo, a new poll does not start before the previous one finishes; if the status has not changed, state is not updated (so nothing flickers). `runAction`: if the repo is busy, `{ ok: false, error: '<repo.name>: başka bir işlem sürüyor' }` without calling `fn`; otherwise `busy` = label → `fn` → `busy` cleared → that repo is refreshed right away → the result is returned.
- `App`: `pollMs` default 2000, `openFile` default `openInZed`. Holds the `Mode` state; list keys are handled only while `mode.kind === 'list'`. Holds a notice line (`notice`): every `ActionResult`'s `message`/`error` is written there (errors in red).
- Layout (top to bottom): header `edi · <dir, home dir as ~>` + `↻ N sn önce` on the right; the list; a separator; the notice line; two lines of key help (the spec's text verbatim). List height = terminal rows − 5; recalculated on the `resize` event.
- Row: the row under the cursor starts with `›` and is inverted, the others with a space. Repo row: `▾`/`▸`, name, the `repoSummary` fields. File row: indented `statusLetter`, path, `statusTag`. Long text is truncated (`wrap="truncate-end"`).
- List mode keys: `↑`/`k`, `↓`/`j`; `enter` (repo: open/close and write to the override; file: if `isDeleted`, notice `'dosya silinmiş'`, otherwise `openFile(join(repo.path, file.path))`); `r` (`rescan`); `q` (quit). The cursor is tied to the key via `resolveCursor`.
- `zedCandidates`: in order `{ cmd: 'zed' }` (only with `zedOnPath`), `{ cmd: '/Applications/Zed.app/Contents/MacOS/cli' }`, `{ cmd: 'open', args: ['-a', 'Zed', file] }`. `openInZed` tries them in order; if all fail, `{ ok: false, error: 'Zed açılamadı' }`.
- `cli.tsx`: `#!/usr/bin/env node`; the argument folder (otherwise `process.cwd()`), resolved with `realpath` (the session matching in Task 9 works with real paths); if it is not a folder, stderr `edi: <yol> bir klasör değil`, exit code 1; if there are no repos, `edi: <yol> altında git reposu yok`, exit code 1; otherwise switch to the alternate screen (`\x1b[?1049h`), draw `App`, and switch back on exit (`\x1b[?1049l`).

- [ ] **Step 1: Write the failing tests** (real temp repos, `pollMs: 50`, fake `openFile`):

```tsx
it('shows the repos and their status');        // '✓ temiz' on the 'temiz-repo' row; '● 2 değişiklik' on the 'kirli-repo' row with a.txt, b.txt below it
it('j/k navigate, enter closes the repo and it stays closed'); // a.txt not visible after enter; still not visible after the next poll
it('enter opens the file by absolute path', async () => expect(openFile).toHaveBeenCalledWith(join(dirty, 'a.txt')));
it('enter on a deleted file does not open it, says "dosya silinmiş"');
it('a new file enters the list through polling'); // write c.txt after render → c.txt in the frame
it('the cursor stays on the same file when a row is inserted'); // cursor on b.txt; a0.txt added → the row with '›' is b.txt
it('r finds a new repo');                      // initRepo after render → r → its name shows
it('a deleted repo row shows an error, the other keeps refreshing'); // rm -rf repoA → '!' on its row; add a file to repoB → it shows
it('a 30-row list does not overflow a 10-row terminal, the cursor stays visible'); // j 20 times → '›' in the frame; row count ≤ 10
// tests/useRepos.test.tsx — with a small test component
it('a second runAction on a busy repo is not run', async () => { expect(second).toEqual({ ok: false, error: 'a: başka bir işlem sürüyor' }); expect(fn2).not.toHaveBeenCalled(); });
// tests/zed.test.ts
it('zedCandidates', () => {
  expect(zedCandidates('/f', false)).toEqual([{ cmd: '/Applications/Zed.app/Contents/MacOS/cli', args: ['/f'] }, { cmd: 'open', args: ['-a', 'Zed', '/f'] }]);
  expect(zedCandidates('/f', true)[0]).toEqual({ cmd: 'zed', args: ['/f'] });
});
```

- [ ] **Step 2: See it fail.** Run: `npm test` → the new tests FAIL.
- [ ] **Step 3: Write `src/zed.ts` and `src/ui/useRepos.ts`.**
- [ ] **Step 4: Write `src/ui/RepoList.tsx` and `src/ui/App.tsx`.**
- [ ] **Step 5: Write `src/cli.tsx`.**
- [ ] **Step 6: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 7: Commit.** `feat: add live repository list with navigation and open in Zed`

---

### Task 6: Stage, commit and sync keys

**Files:**
- Create: `src/ui/TextPrompt.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/app-actions.test.tsx`

**Interfaces:**
- Consumes: the Task 3 operations; `runAction`, `Mode`, `App` (Task 5).
- Produces:

```ts
export function TextPrompt(props: { label: string; onSubmit(value: string): void; onCancel(): void }): React.JSX.Element;
// Mode extends:
// | { kind: 'confirmAddAll'; repo: Repo } | { kind: 'commit'; repo: Repo; addAll: boolean }
```

Constants:
- `TextPrompt` is drawn in place of the notice line; a single line. Incoming printable text is appended (a paste arrives as many characters; line breaks are dropped), backspace deletes the last code point, `enter` submits, `esc` cancels.
- `space`: on a file, if it is `conflicted`, notice `'çakışmalı dosya; edi'de çözülemez'`; if `hasUnstaged`, `stageFile`, otherwise `unstageFile`. On a repo: nothing if there are no changes; `unstageAll` if every file is fully staged, otherwise `stageAll`.
- `c`: with no changes, notice `'commit edilecek bir şey yok'`; if something is staged, `commit` mode (`addAll: false`, label `commit mesajı: `); otherwise `confirmAddAll` mode, with the text verbatim `Stage'li dosya yok. Tüm değişiklikler (yeni dosyalar dahil) commit edilsin mi? (e/h)` — `e` → `commit` mode (`addAll: true`), `h`/`esc` → list.
- `p` / `l` / `f`: `push` / `pull` / `fetchRepo` on the cursor's repo. `F`: `fetchRepo` on every repo in parallel; when done, notice `'fetch tamam (N repo)'` or the first error.
- All through `runAction`; busy labels `'commit ediliyor…'`, `'push ediliyor…'`, `'pull ediliyor…'`, `'fetch ediliyor…'`, and `'…'` for stage/unstage.

- [ ] **Step 1: Write the failing tests:**

```tsx
it('space stages a new file, pressing again undoes it');         // '[staged]' appears / disappears
it('space on a repo row stages everything, pressing again undoes it all');
it('space on a conflicted file shows a notice');                 // "çakışmalı dosya; edi'de çözülemez"
it('c commits the staged files', async () => { /* 'feat: x' + enter */ expect(await git(repo, 'log', '-1', '--format=%s')).toBe('feat: x\n'); /* the other file is still listed */ });
it('with nothing staged, c asks for confirmation; h cancels');   // frame contains the confirmation text; rev-list --count unchanged
it('after e in the confirmation, all changes are committed with the message'); // '✓ temiz'
it('c on a clean repo says "commit edilecek bir şey yok"');
it('esc closes the commit input and list keys work again');
it('a message with Turkish characters is committed verbatim');  // 'fix: çökme düzeltildi'
it('pasted multi-line text collapses into one line');            // stdin.write('feat: a\nb') → subject 'feat: ab'
it('p sends a branch without upstream to origin');               // in the bare repo rev-parse main === local HEAD; 'upstream yok' disappears
it('l on diverged history shows the error, HEAD unchanged');
it('F fetches every repo');                                      // 'fetch tamam (2 repo)'; '↓1' on the repo that is behind
it('with index.lock present, space shows the error and the list keeps refreshing'); // 'index.lock' in the notice; once the lock is removed and a file is added, it shows
```

- [ ] **Step 2: See it fail.** Run: `npx vitest run tests/app-actions.test.tsx` → FAIL.
- [ ] **Step 3: Write `TextPrompt`.**
- [ ] **Step 4: Add the modes and keys to `App.tsx`.**
- [ ] **Step 5: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 6: Commit.** `feat: add stage, commit and sync key bindings`

---

### Task 7: Branch picker

**Files:**
- Create: `src/ui/BranchPicker.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/app-branch.test.tsx`

**Interfaces:**
- Consumes: `listBranches`, `switchBranch`, `createBranch` (Task 3); `runAction`, `Mode` (Task 5); `TextPrompt` (Task 6).
- Produces:

```ts
export function BranchPicker(props: { repoName: string; branches: string[]; current: string | null; height: number;
  onSwitch(name: string): void; onNew(): void; onCancel(): void }): React.JSX.Element;
// Mode extends:
// | { kind: 'branch'; repo: Repo; branches: string[]; current: string | null } | { kind: 'newBranch'; repo: Repo }
```

Constants: `b` → `listBranches`; on error a notice, otherwise `branch` mode. The picker is drawn in place of the list: header `<repoName> · branch`, then the rows; the current branch is marked with `*` and the cursor starts on it; if it exceeds `height`, it scrolls with `windowTop`. `↑↓`/`j`/`k`, `enter` → `onSwitch` (choosing the current branch only closes it), `n` → `newBranch` mode (`TextPrompt`, label `yeni branch: `; an empty name is ignored), `esc` → list. Operations go through `runAction`, label `'branch değiştiriliyor…'`.

- [ ] **Step 1: Write the failing tests:**

```tsx
it('b shows the branches, the current one marked');    // frame contains '* main' and 'feat/x'
it('choosing one and pressing enter switches branch'); // 'feat/x' on the repo row
it('n creates a new branch and switches to it');       // type 'fix/y' + enter → 'fix/y' on the repo row
it('esc closes without changing anything');
it('an empty new branch name does nothing');
it('with conflicting changes the switch is refused, the error shows, the branch stays the same');
```

- [ ] **Step 2: See it fail.** Run: `npx vitest run tests/app-branch.test.tsx` → FAIL.
- [ ] **Step 3: Write `BranchPicker` and wire it into `App.tsx`.**
- [ ] **Step 4: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat: add branch picker`

---

### Task 8: Diff view

**Files:**
- Create: `src/ui/DiffView.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/app-diff.test.tsx`

**Interfaces:**
- Consumes: `diffFile`, `diffRepo` (Task 3); `Mode` (Task 5).
- Produces:

```ts
export function diffLineColor(line: string): 'green' | 'red' | 'cyan' | undefined;
export function DiffView(props: { title: string; text: string; height: number; onClose(): void }): React.JSX.Element;
// Mode extends: | { kind: 'diff'; title: string; text: string }
```

Constants: `d` runs `diffFile` on a file, `diffRepo` on a repo; on error a notice, otherwise `diff` mode (title: the file path or the repo name). The view covers the whole screen: a title line + `height` lines of content + a bottom line `↑↓ kaydır · space/b sayfa · g/G baş/son · esc kapat`. Only the visible slice is drawn; long lines are truncated. `diffLineColor`: starting with `+++`/`---` → `undefined`; `+` → `'green'`; `-` → `'red'`; `@@` → `'cyan'`. For an empty diff the content is `değişiklik yok`. Keys: `↑↓`/`j`/`k` one line, `space`/PageDown and `b`/PageUp one page, `g`/`G` start/end, `esc`/`q` close it (they do not quit the app).

- [ ] **Step 1: Write the failing tests:**

```tsx
it('diffLineColor', () => expect(['+++ b/x', '--- a/x', '+a', '-b', '@@ -1 +1 @@', ' c'].map(diffLineColor)).toEqual([undefined, undefined, 'green', 'red', 'cyan', undefined]));
it('d shows the diff of a changed file');            // '+yeni satır'
it('d shows the content of a new file as additions');
it('d on a repo row shows every file');              // scrolling down to G, both the a.txt and unt.txt headers have been seen
it('esc returns to the list');
it('q inside the diff does not quit the app, returns to the list');
it('a 5000-line diff does not overflow a 10-row terminal; G shows the last line'); // frame row count ≤ 10; G → '+satır 5000'
```

- [ ] **Step 2: See it fail.** Run: `npx vitest run tests/app-diff.test.tsx` → FAIL.
- [ ] **Step 3: Write `DiffView` and wire it into `App.tsx`.**
- [ ] **Step 4: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat: add scrollable diff view`

---

### Task 9: Claude Code indicator

**Files:**
- Create: `src/sessions.ts`
- Modify: `src/ui/App.tsx`, `src/ui/RepoList.tsx`
- Test: `tests/sessions.test.ts`, `tests/app-sessions.test.tsx`

**Interfaces:**
- Consumes: `Repo` (Task 1); `App`, `AppProps` (Task 5).
- Produces:

```ts
export function parseLsofCwd(out: string): string[];      // the paths of the 'n' lines in `lsof -Fpn` output
export function listClaudeCwds(): Promise<string[]>;      // [] on any error
export function assignSessions(cwds: string[], dir: string, repos: Repo[]): { root: number; byRepo: Record<string, number> };
// AppProps extends: listSessions?: () => Promise<string[]>; sessionPollMs?: number
```

Constants: `listClaudeCwds`: `pgrep -x claude` → pids joined with commas → `lsof -a -d cwd -p <pids> -Fpn`; `[]` if there is no process or a command fails. `assignSessions`: if a cwd equals a `repo.path` or is under it (on a path **segment** boundary: `…/quizei-app-next-quiz` does not count for `…/quizei-app`), `byRepo[repo.path]++`; otherwise, if it equals `dir` or is under it, `root++`; otherwise it is ignored. `listSessions` defaults to `listClaudeCwds`, `sessionPollMs` to 5000; if `listSessions` rejects, the counts are reset and no notice is shown. Drawing: mark `✻`, color `#D97757`; on a repo row `✻` before the name (`✻2` if the count is > 1); in the header `✻ N` after the folder (only while `root > 0`).

- [ ] **Step 1: Write the failing tests:**

```ts
it('parseLsofCwd', () => expect(parseLsofCwd('p50792\nfcwd\nn/a/quizei\np53467\nfcwd\nn/a/quizei/quizei-app\n')).toEqual(['/a/quizei', '/a/quizei/quizei-app']));
it('assignSessions', () => expect(assignSessions(
  ['/a/quizei', '/a/quizei', '/a/quizei/quizei-app/src', '/a/quizei/quizei-app-next-quiz', '/a/quizei/temp', '/baska/yer'],
  '/a/quizei', [{ name: 'quizei-app', path: '/a/quizei/quizei-app' }, { name: 'quizei-app-next-quiz', path: '/a/quizei/quizei-app-next-quiz' }],
)).toEqual({ root: 3, byRepo: { '/a/quizei/quizei-app': 1, '/a/quizei/quizei-app-next-quiz': 1 } }));
it('listClaudeCwds does not throw', async () => expect(Array.isArray(await listClaudeCwds())).toBe(true));
// App, with listSessions injected
it('shows ✻ in the header and on the repo row'); // [dir, dir, repoA] → header line '✻ 2'; repoA row '✻'; no '✻' on the repoB row
it('two sessions in the same repo show ✻2');
it('if listSessions rejects, no mark, the app keeps running');
```

- [ ] **Step 2: See it fail.** Run: `npx vitest run tests/sessions.test.ts tests/app-sessions.test.tsx` → FAIL.
- [ ] **Step 3: Write `src/sessions.ts`.**
- [ ] **Step 4: Add the polling and drawing to `App.tsx` and `RepoList.tsx`.**
- [ ] **Step 5: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 6: Commit.** `feat: show Claude Code session indicator`

---

### Task 10: Build, install and a trial run on a real folder

**Files:**
- Create: `README.md`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `src/cli.tsx` (Task 5), `npm run build` (Task 1).

- [ ] **Step 1: Write the failing test** (runs the built `dist/cli.js` with `node`; `npm run build` in `beforeAll`):

```ts
it('exits with 1 on an argument that is not a folder', async () => { expect(code).toBe(1); expect(stderr).toContain('bir klasör değil'); });
it('exits with 1 in a folder with no repos', async () => { expect(code).toBe(1); expect(stderr).toContain('altında git reposu yok'); });
```

- [ ] **Step 2: See it fail, fix the build.** Run: `npx vitest run tests/cli.test.ts`. If the built ESM is missing the `.js` extension on relative imports, or `dist/cli.js` is missing its shebang + execute permission, fill them in (`build` script `tsc && chmod +x dist/cli.js`).
- [ ] **Step 3: Make the tests pass.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 4: Write `README.md`.** Install (`npm install && npm run build && npm link`), usage (`edi [klasör]`), key table, what is not in the first version.
- [ ] **Step 5: Install.** Run: `npm run build && npm link && command -v edi` → prints a path.
- [ ] **Step 6: Observation only on a real folder.** Run: `edi ~/studios/quizei`. Eight repos should be listed; open Claude Code sessions should show with `✻` in the header; try `j`/`k`, `enter` (open/close) and `d`, quit with `q`. **In this step, do not press `space`, `c`, `p`, `l`, `f`, `F`, `b`**; the user makes the first trial that changes real repos themselves.
- [ ] **Step 7: Commit.** `docs: add README and verify built CLI`
