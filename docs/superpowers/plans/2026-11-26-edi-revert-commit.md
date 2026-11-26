# Revert Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert any non-merge commit on the current branch from a ⋯ menu in the commit view and a right-click menu in History, aborting automatically if it conflicts.

**Architecture:** A new `revertCommit` git op runs through the existing `git:run` path (busy label, one write per repo, error box). Menus are native popups built in the main process (`HistoryOps.commitMenu`), confirmation is a native question like Undo commit's. The renderer store wires menu choices to copy / open URL / revert, and on a failed revert shows the Git tab with that repo expanded.

**Tech Stack:** TypeScript, Electron (main + preload + React renderer), zustand store, vitest (+ jsdom, testing-library), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-26-edi-revert-commit-design.md`

## Global Constraints

- Code comments, tests, and docs are in English.
- Commits follow Conventional Commits 1.0.0, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `feat/revert-commit`, not `main`.
- The page isn't trusted: the main process checks every argument (repo path via `Workspace.repo`, oid against `/^[0-9a-f]{40,64}$/`).
- Command: `git revert --no-edit <oid>`. On a stop that leaves `REVERT_HEAD`: `git revert --abort`.
- Confirmation copy: message `Revert the commit "<subject>"?` (subject cut to 60 chars with `…`, as in `undoCommitQuestion`), detail `A new commit is made that undoes its changes. The original commit stays in the history.`, buttons `['Revert commit', 'Cancel']`, `defaultId: 0`, `cancelId: 1`, `type: 'warning'`.
- Menu labels: `Copy SHA`, `Open on GitHub`, `Revert Commit…`. Open on GitHub is left out when there is no GitHub URL for the commit; Revert is disabled (not hidden) for merge commits.
- Busy label: `Reverting…`. Success message: `Commit reverted`.
- Gates: `npm test`, `npm run typecheck`, and for the last task `npm run e2e`.

## Review Focus

- A revert, cherry-pick, merge or rebase the user already has in progress must not be aborted by edi: the op refuses before running git. Pinned in Task 1.
- A conflicting revert while unrelated uncommitted changes exist in another file: after the automatic abort those changes are still there. Pinned in Task 1.
- Reverting a commit whose changes are already undone ("nothing to commit"): HEAD unchanged, no `REVERT_HEAD`, a clear message. Pinned in Task 1.
- An old commit tab left open after switching branches: Revert from it is refused with "not on the current branch", nothing runs. Pinned in Task 1.
- A failed revert started from History while the Git tab is hidden: the Git tab is selected and the repo expanded so the error is visible. Pinned in Task 3.

---

### Task 1: The `revertCommit` git op

**Files:**
- Create: `src/git/revert.ts`
- Modify: `src/git/actions.ts` (export `SLOW_TIMEOUT_MS`)
- Modify: `src/shared/api.ts` (`GitOp` union)
- Modify: `src/main/gitOps.ts` (`busyLabel`, `isValidOp`, `execute`)
- Test: `tests/revert.test.ts` (new), `tests/gitOps.test.ts`

**Interfaces:**
- Consumes: `runGit` (`src/git/exec.ts`), `gitDirs(repo): Promise<GitDirs | null>` (`src/git/refsStamp.ts`, `.git` is the repo's own git dir), `operationIn(gitDir)` (`src/git/operation.ts`), `overwriteError`, `CONFLICT_ERROR`, `ActionResult` (`src/git/actions.ts`).
- Produces: `revertCommit(repo: string, oid: unknown): Promise<ActionResult>` in `src/git/revert.ts`; `GitOp` member `{ op: 'revertCommit'; oid: string }`; exported error strings `REVERT_CONFLICT = "This commit can't be reverted cleanly: it conflicts with later changes"` and `ALREADY_REVERTED = "This commit's changes are already undone"`.

- [ ] **Step 0: Branch and commit the design docs**

```bash
git switch -c feat/revert-commit
git add docs/superpowers/specs/2026-11-26-edi-revert-commit-design.md docs/superpowers/plans/2026-11-26-edi-revert-commit.md
git commit -m "docs(git): design and plan for reverting a commit"
```

- [ ] **Step 1: Write the failing tests in `tests/revert.test.ts`**

Use `initRepo`, `git`, `makeTmpDir` from `tests/helpers/tmpRepo.js` and a local `commitFile(repo, name, text, message)` helper like `tests/unpushed.test.ts`'s. Cases (each asserts `git log -1 --format=%s`, `git status --porcelain`, and that `.git/REVERT_HEAD` does not exist afterwards, where relevant):

1. `reverts a commit with one new commit; the original stays` — commits `one` (f=a), `two` (f=b), `three` (g=x); `revertCommit(repo, oidOfTwo)` → `{ ok: true, message: 'Commit reverted' }`; last subject `Revert "two"`; `f` is `a\n`; `git log --format=%s` still contains `two`.
2. `a conflicting revert is aborted and nothing is left half done` — commits f=a, f=b (target), f=c; also write an uncommitted change to an unrelated tracked file `g`. Result `{ ok: false, error: REVERT_CONFLICT }`; HEAD unchanged; `f` is `c\n`; `g` still has the uncommitted text; no `REVERT_HEAD`.
3. `reverting an already undone commit says so and leaves no state` — revert target once (ok), then again → `{ ok: false, error: ALREADY_REVERTED }`; HEAD unchanged; no `REVERT_HEAD`.
4. `refuses while another operation is in progress, without touching it` — create a conflicting `git cherry-pick` so `CHERRY_PICK_HEAD` exists; `revertCommit` → `{ ok: false, error: 'A cherry-pick is in progress; finish it first' }`; `CHERRY_PICK_HEAD` still exists.
5. `refuses a commit that is not on the current branch` — commit on branch `side`, switch back to `main`; → `{ ok: false, error: 'This commit is not on the current branch' }`.
6. `refuses a merge commit` — make a `--no-ff` merge; → `{ ok: false, error: 'A merge commit cannot be reverted here' }`.
7. `local changes in the way are refused by git, and kept` — stage a new file `h`; revert an older commit → `ok: false`, error matches `/local changes/i`; `h` is still staged; no `REVERT_HEAD`.
8. `rejects a malformed or unknown oid` — `'abc'`, `42`, `'-x'.padEnd(40, '0')` → `{ ok: false, error: 'Invalid commit' }`; `'f'.repeat(40)` → `{ ok: false, error: 'Commit not found' }`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/revert.test.ts`
Expected: FAIL, cannot resolve `../src/git/revert.js`.

- [ ] **Step 3: Implement `revertCommit(repo, oid)` in `src/git/revert.ts`**

Check in this order, stopping at the first failure:
1. `oid` is a string matching `/^[0-9a-f]{40,64}$/`, else `Invalid commit`.
2. `rev-parse --verify --quiet --end-of-options <oid>^{commit}` (okCodes `[0, 1, 128]`) gives that oid, else `Commit not found`.
3. `gitDirs(repo)`; `operationIn(dirs.git)` non-null → `` `A ${operation} is in progress; finish it first` ``.
4. `diff --name-only --diff-filter=U` non-empty → `CONFLICT_ERROR`.
5. `merge-base --is-ancestor <oid> HEAD` (okCodes `[0, 1]`; exit 1 → `This commit is not on the current branch`).
6. `rev-list --parents -n 1 <oid>`: more than one parent → `A merge commit cannot be reverted here` (a root commit is allowed).
7. `revert --no-edit <oid>` with `timeoutMs: SLOW_TIMEOUT_MS` (export it from `actions.ts`; hooks may run).

On failure of step 7: if `operationIn(dirs.git)` is now `'revert'`, run `revert --abort` and return `REVERT_CONFLICT` (if the abort itself fails: `` `${REVERT_CONFLICT}, and undoing the attempt failed: ${abort.error}` ``). Otherwise, if git's stdout contains `nothing to commit`, return `ALREADY_REVERTED`; else `overwriteError(stderr) ?? error`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/revert.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire the op and test it in `tests/gitOps.test.ts`**

Add `| { op: 'revertCommit'; oid: string }` to `GitOp` (doc comment: "`git revert --no-edit`; aborted again if it stops on conflicts"). In `gitOps.ts`: `busyLabel` → `'Reverting…'`; `isValidOp` accepts it with a string `oid` (next to `undoCommit`); `execute` → `revertCommit(repo, op.oid)`.

Tests: `expect(busyLabel({ op: 'revertCommit', oid: 'a'.repeat(40) })).toBe('Reverting…')`; and through `ops.run(repo, { op: 'revertCommit', oid })` on a real repo → `{ ok: true, message: 'Commit reverted' }`, `{ op: 'revertCommit' }` without oid → `{ ok: false, error: 'Invalid operation' }`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/revert.test.ts tests/gitOps.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/git/revert.ts src/git/actions.ts src/shared/api.ts src/main/gitOps.ts tests/revert.test.ts tests/gitOps.test.ts
git commit -m "feat(git): revert a commit, aborting if it conflicts"
```

---

### Task 2: Main process: confirmation and the commit menu

**Files:**
- Modify: `src/main/questions.ts` (`revertCommitQuestion`)
- Modify: `src/main/historyOps.ts` (`commitMenu`, optional menu dependency)
- Modify: `src/main/ipc.ts` (`git:confirmRevert`, `history:commitMenu`, pass `menu` to `HistoryOps`)
- Modify: `src/preload/preload.cts`, `src/shared/api.ts`
- Test: `tests/questions.test.ts`, `tests/historyOps.test.ts`

**Interfaces:**
- Consumes: `commitWebUrl(repo, oid)` (`src/git/remoteUrl.ts`), `AppCore.popup` (`src/main/ipc.ts`).
- Produces, in `src/shared/api.ts`:
  - `export type CommitMenuAction = 'copy' | 'github' | 'revert';`
  - `export type CommitMenuChoice = { action: 'copy' } | { action: 'github'; url: string } | { action: 'revert' };`
  - `EdiApi.confirmRevert(subject: string): Promise<boolean>` (channel `git:confirmRevert`)
  - `EdiApi.commitMenu(repoPath: string, oid: string, opts: { links: boolean; canRevert: boolean }): Promise<CommitMenuChoice | null>` (channel `history:commitMenu`). `links`: include Copy SHA and Open on GitHub (History); false gives only Revert (commit view ⋯).
- Produces in `src/main/historyOps.ts`: `new HistoryOps(ws, deps?: { menu(items: { id: CommitMenuAction | null; label: string; enabled?: boolean }[]): Promise<CommitMenuAction | null> })`, and `commitMenu(repoPath: unknown, oid: unknown, opts: unknown): Promise<CommitMenuChoice | null>`.

- [ ] **Step 1: Write the failing tests**

`tests/questions.test.ts`: `revertCommitQuestion('feat: a')` equals the Global Constraints question; a 100-char subject is cut to 59 chars + `…`.

`tests/historyOps.test.ts` (fake `menu` that records its items and returns a set id):
- `links: true` in a repo without a remote → items `['Copy SHA', '-', 'Revert Commit…']`; picking `copy` → `{ action: 'copy' }`.
- `links: true` with a bare remote at a `https://github.com/o/r.git` URL and the commit pushed (`git remote set-url` after pushing to a local bare repo, as `tests/remoteUrl.test.ts` does) → `Open on GitHub` present; picking `github` → `{ action: 'github', url: 'https://github.com/o/r/commit/<oid>' }`.
- `links: false, canRevert: false` → items `[{ id: 'revert', label: 'Revert Commit…', enabled: false }]`.
- unknown repo, short or malformed oid, or non-object opts → `null` and the menu is never shown; menu closed without a pick → `null`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/questions.test.ts tests/historyOps.test.ts`
Expected: FAIL, `revertCommitQuestion` / `commitMenu` not defined.

- [ ] **Step 3: Implement**

`revertCommitQuestion(subject: string): Question` beside `undoCommitQuestion`. `HistoryOps.commitMenu`: validate, read `commitWebUrl` only when `links` is true, build items (Copy SHA, Open on GitHub if a URL, separator, Revert Commit… with `enabled: canRevert === true`), show via `deps.menu`, map the pick to a `CommitMenuChoice`. In `ipc.ts` construct `new HistoryOps(this.workspace, { menu: (items) => this.popup(items) })` and register both handlers (`git:confirmRevert` takes the subject like `git:confirmUndo`). Add both to `preload.cts` and `EdiApi`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/questions.test.ts tests/historyOps.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/questions.ts src/main/historyOps.ts src/main/ipc.ts src/preload/preload.cts src/shared/api.ts tests/questions.test.ts tests/historyOps.test.ts
git commit -m "feat(history): commit menu and revert confirmation in the main process"
```

---

### Task 3: Store actions

**Files:**
- Modify: `src/renderer/store.ts`
- Test: `tests/renderer/revertStore.test.ts` (new; bridge mock set up like `tests/renderer/stashStore.test.ts`)

**Interfaces:**
- Consumes: `edi.confirmRevert`, `edi.git`, `CommitMenuChoice` (Task 2); existing `gitOp`, `openUrl`, `setRightTab`, `toggleRepo`, `errors`.
- Produces on the store:
  - `revertCommit(repoPath: string, commit: { oid: string; subject: string }): Promise<void>` — asks with `edi.confirmRevert(subject)`; on yes runs `gitOp(repoPath, { op: 'revertCommit', oid })`; if `errors[repoPath]` is then set, `setRightTab('git')` and `toggleRepo(repoPath, true)`.
  - `commitAction(repoPath: string, commit: { oid: string; subject: string }, choice: CommitMenuChoice): Promise<void>` — `copy` writes the oid with `navigator.clipboard.writeText` (errors swallowed), `github` calls `openUrl(url)`, `revert` calls `revertCommit`.

- [ ] **Step 1: Write the failing tests**

- `cancel at the question runs nothing` — `confirmRevert` resolves false → `edi.git` not called.
- `confirmed: runs revertCommit with the oid` — `edi.git` called with `('/w/app', { op: 'revertCommit', oid })`; `rightTab` unchanged (`'history'` set beforehand).
- `a failed revert shows the Git tab with the repo expanded` — `rightTab` set to `'history'`, `expanded` empty; `edi.git` resolves `{ ok: false, error: REVERT_CONFLICT text }` → `rightTab === 'git'`, `expanded['/w/app'] === true`, `errors['/w/app']` is the text.
- `commitAction: copy writes the full oid; github opens the URL` — stub `navigator.clipboard.writeText` and `edi.openUrl`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/renderer/revertStore.test.ts`
Expected: FAIL, `revertCommit` is not a function.

- [ ] **Step 3: Implement both actions in `store.ts`** (declare them on the state interface next to `stashAction`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store.ts tests/renderer/revertStore.test.ts
git commit -m "feat(git): store actions to revert a commit and act on the commit menu"
```

---

### Task 4: The ⋯ button and the History right-click

**Files:**
- Modify: `src/renderer/center/CommitPane.tsx`, `src/renderer/center/CommitView.tsx`, `src/renderer/center/center.css` (only if the button needs styling beyond `commit-copy`)
- Modify: `src/renderer/history/HistoryPanel.tsx`
- Test: `tests/renderer/CommitPane.test.tsx`, `tests/renderer/HistoryPanel.test.tsx`

**Interfaces:**
- Consumes: `edi.commitMenu` (Task 2), `commitAction` (Task 3), `MoreIcon` (`src/renderer/components/icons.tsx`).
- Produces:
  - `CommitPaneProps.onMore?(): void` — renders a button after the GitHub button: `className="commit-copy commit-more"`, `data-testid="commit-more"`, `aria-label="More actions"`, `title="More actions"`, content `<MoreIcon size={12} />`. Absent prop → no button.
  - `HistoryPanelViewProps.onCommitMenu?(repoPath: string, commit: CommitSummary): void` — called from `onContextMenu` (after `preventDefault()`) on `history-commit`, `history-release` and `history-line` rows.

- [ ] **Step 1: Write the failing tests**

- CommitPane: with `onMore` a `More actions` button exists and clicking it calls `onMore` once; without it there is none.
- HistoryPanelView: right-clicking (`fireEvent.contextMenu`) a Timeline commit row, a release row, and a By repo line calls `onCommitMenu` with that row's repo path and commit; a plain click still calls `onOpenCommit` and not `onCommitMenu`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/renderer/CommitPane.test.tsx tests/renderer/HistoryPanel.test.tsx`
Expected: FAIL, button / handler missing.

- [ ] **Step 3: Implement and bind**

`CommitView` passes `onMore` that calls `edi.commitMenu(repo.path, commit.oid, { links: false, canRevert: commit.parents === 1 })` and, on a choice, `useApp.getState().commitAction(repo.path, commit, choice)`. `HistoryPanel` passes `onCommitMenu` doing the same with `{ links: true, canRevert: commit.parents === 1 }`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/center src/renderer/history tests/renderer/CommitPane.test.tsx tests/renderer/HistoryPanel.test.tsx
git commit -m "feat(history): revert from the commit view's ⋯ menu and History's right-click menu"
```

---

### Task 5: End-to-end test and spec updates

**Files:**
- Modify: `e2e/history.spec.ts`
- Modify: `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` (History section: right-click menu; Unpushed paragraph unchanged), `docs/superpowers/specs/2026-11-24-edi-editor-files-git-design.md` (Non-goals: change to "Undoing any unpushed commit other than the newest one" and add a pointer to the revert design)

**Interfaces:**
- Consumes: everything above; the `nextMenuPicks(app, label)` pattern from `e2e/files.spec.ts` (copy it into `history.spec.ts` or move it into `e2e/helpers.ts` and use it from both).

- [ ] **Step 1: Write the e2e test** `a commit is reverted from History's menu and from the commit view's ⋯; a conflicting one is aborted`

Repo `alpha` with commits `feat: one` (f=a), `feat: two` (f=b), `feat: three` (g=x). With dialogs answered "confirm":
1. `nextMenuPicks(app, 'Revert Commit…')`, right-click the History row `feat: three` → `git log -1 --format=%s` is `Revert "feat: three"` and the row appears at the top of History.
2. Open `feat: one` in the commit view, `nextMenuPicks(app, 'Revert Commit…')`, click `commit-more` → f conflicts with `feat: two`: the right panel shows the Git tab, the repo's error box contains `can't be reverted cleanly`, `.git/REVERT_HEAD` doesn't exist and HEAD is still `Revert "feat: three"`.

- [ ] **Step 2: Run it**

Run: `npm run e2e -- e2e/history.spec.ts`
Expected: PASS.

- [ ] **Step 3: Update the two specs, then run the whole gate**

Run: `npm test && npm run typecheck && npm run e2e`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e docs/superpowers/specs
git commit -m "test(history): revert end to end; docs: note revert in the app spec"
```
