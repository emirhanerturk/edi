# Discard Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discard a file's unstaged changes, or every unstaged change in a repo, from the Git tab's CHANGES section; new files go to the Trash.

**Architecture:** New `discard` / `discardAll` git ops in `src/git/discard.ts`, run through `GitOps` (`git:run`) with an injected `trash` dependency. The store asks first through a native question built in the main process, then runs the op. The view adds a discard button per CHANGES row and one on the CHANGES header.

**Tech Stack:** TypeScript, Electron, React, zustand, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-edi-discard-changes-design.md`

## Global Constraints

- Code comments, tests and docs in English. Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/discard-changes`.
- Tracked files: `git restore --worktree -- :(literal)<path>` (only the work tree; the index, i.e. a staged part, stays). Never `git clean`, `checkout --` or `reset --hard`.
- Untracked files: `trash(absolutePath)` (Electron `shell.trashItem` in the app), only for a path that resolves inside the repo.
- The page isn't trusted: the file is looked up again in a fresh `getStatus`; the page's object is only used for its `path`.
- With any conflicted file in the repo both ops refuse with `CONFLICT_ERROR`; the buttons are disabled with title `Resolve the conflicts first`.
- Busy label `Discarding…`. Success messages: `Discarded` (file), `Discarded all changes` (all).
- Questions (`type: 'warning'`, `buttons: ['Discard', 'Cancel']`, `defaultId: 0`, `cancelId: 1`):
  - tracked file: message `Discard changes to <name>?`, detail `This can't be undone.`
  - new file: message `Move <name> to the Trash?`, detail `It is new, so git has no copy of it.`
  - all: message `Discard all changes in <repo>?`, detail built from the counts: `<n> changed file is reset` / `<n> changed files are reset`, and `<n> new file goes to the Trash` / `<n> new files go to the Trash`, joined with ` and `, a zero part left out, then `. Staged changes stay. This can't be undone.`
- Test ids: `discard-file` (row), `discard-all` (header). Row button title `Discard changes`, aria-label `Discard changes to <name>`; header title `Discard all changes`, aria-label `Discard all changes`. Icon: lucide `RotateCcw`, size 12. The row button sits left of `stage-file`; the header button left of `stage-all`.

## Review Focus

- A row that went stale (the file was committed or reset in a terminal since the last poll): refused with `File is not in the list of changes`, nothing touched. Task 1.
- A partly staged file: its staged part survives a discard, both per file and for all. Task 1.
- Discard all with staged-only files around: those files are untouched. Task 1.
- An untracked path that would resolve outside the repo is never trashed. Task 1.
- Conflicts in the repo: both ops refuse, both buttons disabled. Tasks 1 and 3.

---

### Task 1: Git layer and op wiring

**Files:**
- Create: `src/git/discard.ts`
- Modify: `src/shared/api.ts` (`GitOp`), `src/main/gitOps.ts` (deps, `busyLabel`, `isValidOp`, `execute`), `src/main/ipc.ts` (pass `trash`)
- Test: `tests/discard.test.ts` (new), `tests/gitOps.test.ts`

**Interfaces:**
- Consumes: `getStatus`, `hasUnstaged` (`src/git/status.ts`), `CONFLICT_ERROR`, `LOCAL_WRITE_TIMEOUT_MS`, `ActionResult` (`src/git/actions.ts`), `runGit`.
- Produces:
  - `type Trash = (absolutePath: string) => Promise<void>`
  - `discardFile(repo: string, path: string, trash: Trash): Promise<ActionResult>` and `discardAll(repo: string, trash: Trash): Promise<ActionResult>` in `src/git/discard.ts`. Both read a fresh status themselves.
  - `GitOp` members `{ op: 'discard'; file: FileChange }` and `{ op: 'discardAll' }`.
  - `new GitOps(ws, deps?: { trash: Trash })`; without `deps`, discarding an untracked file returns `{ ok: false, error: 'Moving to the Trash is not available' }`.

- [ ] **Step 0: Commit the design docs**

```bash
git add docs/superpowers/specs/2026-11-26-edi-discard-changes-design.md docs/superpowers/plans/2026-11-26-edi-discard-changes.md
git commit -m "docs(git): design and plan for discarding changes"
```

- [ ] **Step 1: Write the failing tests in `tests/discard.test.ts`**

Real temp repos (`initRepo(dir, 'r', { commit: true })` has `README.md`), a fake `trash` that records paths and deletes them with `rm`. Cases:
1. `a modified file goes back to its committed text` — edit README → `discardFile` → `{ ok: true, message: 'Discarded' }`, file back, status clean.
2. `a deleted file comes back` — `rm README.md` → discard → file exists again.
3. `a partly staged file keeps its staged part` — stage edit A, then edit B on top → discard → file text is A, `git diff --cached --name-only` still lists it, `git diff --name-only` empty.
4. `a new file goes to the Trash` — `new.txt` untracked → discard → trash called with `join(repo, 'new.txt')`, git untouched.
5. `a stale path is refused and nothing is touched` — discard `README.md` when clean → `{ ok: false, error: 'File is not in the list of changes' }`; a staged-only file (x='M', y='.') → same error, staged content intact.
6. `conflicts refuse both` — create a merge conflict on README → `discardFile(other)` and `discardAll` → `{ ok: false, error: CONFLICT_ERROR }`.
7. `discardAll resets tracked changes, trashes new files, and keeps staged ones` — staged-only `a.txt`, partly staged README (staged A, unstaged B), modified `b.txt`, new `n1.txt` and `dir/n2.txt` → `{ ok: true, message: 'Discarded all changes' }`; trash called with both new files; README is A and still staged; `a.txt` still staged; `b.txt` clean.
8. `an untracked path outside the repo is never trashed` — call the exported path guard `insideRepo(repo, '../x')` → false; `insideRepo(repo, 'a/../../x')` → false; `insideRepo(repo, 'dir/n.txt')` → true.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/discard.test.ts` — Expected: FAIL, cannot resolve `../src/git/discard.js`.

- [ ] **Step 3: Implement `src/git/discard.ts`**

`insideRepo(repo: string, path: string): boolean` (exported): `resolve(repo, path)` starts with `repo + sep` and `path` isn't absolute. `discardFile`: fresh status; any conflicted → `CONFLICT_ERROR`; find the entry by path with `hasUnstaged`, else `File is not in the list of changes`; untracked → guard then `trash(resolve(repo, path))` (a thrown error becomes `{ ok: false, error: message }`); otherwise `restore --worktree -- :(literal)<path>` with `LOCAL_WRITE_TIMEOUT_MS`. `discardAll`: fresh status; conflicts refuse; one `restore --worktree -- <literal paths…>` for the tracked entries with unstaged changes (skipped if none), then trash each untracked entry in order.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/discard.test.ts` — Expected: PASS (8 tests).

- [ ] **Step 5: Wire the ops; tests in `tests/gitOps.test.ts`**

`busyLabel` → `Discarding…` for both. `isValidOp`: `discard` needs a `file` object with a string `path` (same check as `stage`); `discardAll` needs nothing. `execute`: `discard` → `discardFile(repo, op.file.path, this.trash)`; `discardAll` → `discardAll(repo, this.trash)`. `ipc.ts`: `new GitOps(this.workspace, { trash: (target) => shell.trashItem(target) })`.

Tests: both busy labels; through `ops.run` on a real repo with a fake trash, a modified README → `{ ok: true, message: 'Discarded' }` and the status refreshed to clean; `{ op: 'discard' }` without file → `Invalid operation`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/discard.test.ts tests/gitOps.test.ts && npm run typecheck` — Expected: PASS.

- [ ] **Step 7: Commit** — `feat(git): discard a file's unstaged changes or all of them; new files go to the Trash`

---

### Task 2: Question, IPC and store action

**Files:**
- Modify: `src/main/questions.ts`, `src/main/ipc.ts`, `src/preload/preload.cts`, `src/shared/api.ts`, `src/renderer/store.ts`
- Test: `tests/questions.test.ts`, `tests/renderer/discardStore.test.ts` (new, bridge mock as in `tests/renderer/stashStore.test.ts`)

**Interfaces:**
- Produces:
  - `export type DiscardTarget = { kind: 'file'; name: string; untracked: boolean } | { kind: 'all'; repo: string; changed: number; untracked: number }` in `src/shared/api.ts`.
  - `discardChangesQuestion(target: DiscardTarget): Question` in `src/main/questions.ts`.
  - `EdiApi.confirmDiscardChanges(target: DiscardTarget): Promise<boolean>`, channel `git:confirmDiscardChanges`. Main validates the shape (strings, non-negative integers) and answers `false` to anything malformed without asking.
  - Store: `discardChanges(repoPath: string, file: FileChange | null): Promise<void>` — `null` means all. Builds the target from the repo's current status (`groupFiles(status).changes`: untracked vs the rest; file name is the path's last segment), asks, and on yes runs `gitOp(repoPath, file ? { op: 'discard', file } : { op: 'discardAll' })`.

- [ ] **Step 1: Write the failing tests**

`questions.test.ts`: the three message/detail texts from Global Constraints, including `discardChangesQuestion({ kind: 'all', repo: 'app', changed: 1, untracked: 0 }).detail === '1 changed file is reset. Staged changes stay. This can\'t be undone.'`, `{ changed: 3, untracked: 2 }` → `'3 changed files are reset and 2 new files go to the Trash. Staged changes stay. This can\'t be undone.'`, `{ changed: 0, untracked: 1 }` → `'1 new file goes to the Trash. Staged changes stay. This can\'t be undone.'`.

`discardStore.test.ts`: (a) a file: `confirmDiscardChanges` called with `{ kind: 'file', name: 'b.ts', untracked: false }` for `src/b.ts`; no → `git` not called; yes → `git` called with `{ op: 'discard', file }`. (b) all, with a status holding a modified, an untracked and a staged-only file → target `{ kind: 'all', repo: 'app', changed: 1, untracked: 1 }`, yes → `{ op: 'discardAll' }`.

- [ ] **Step 2: Run to see them fail** — `npx vitest run tests/questions.test.ts tests/renderer/discardStore.test.ts`, Expected: FAIL (not defined).

- [ ] **Step 3: Implement** the question, the IPC handler (`this.ask(discardChangesQuestion(target))` after validation), preload, `EdiApi`, and the store action.

- [ ] **Step 4: Run tests and typecheck** — `npx vitest run tests/questions.test.ts tests/renderer && npm run typecheck`, Expected: PASS.

- [ ] **Step 5: Commit** — `feat(git): ask before discarding changes`

---

### Task 3: Buttons in the Git tab

**Files:**
- Modify: `src/renderer/git/GitPanelView.tsx`, `src/renderer/git/GitPanel.tsx`
- Test: `tests/renderer/GitPanel.test.tsx`

**Interfaces:**
- Consumes: store `discardChanges` (Task 2).
- Produces: `GitPanelProps.onDiscard?(repoPath: string, file: FileChange | null): void`, passed to the CHANGES `FileGroup` and its rows. No button when the prop is absent.

- [ ] **Step 1: Write the failing tests** (new `describe('Discard')`, using the file's `file(...)` helper and an expanded repo)
- Each CHANGES row has `discard-file` (aria-label `Discard changes to <name>`) before `stage-file`; clicking calls `onDiscard(repoPath, file)` and doesn't open the file.
- The CHANGES header has `discard-all` before `stage-all`; clicking calls `onDiscard(repoPath, null)` and doesn't collapse the section.
- STAGED rows and header have no discard button.
- With a conflicted file both are disabled, title `Resolve the conflicts first`; while busy both are disabled.

- [ ] **Step 2: Run to see them fail** — `npx vitest run tests/renderer/GitPanel.test.tsx`, Expected: FAIL.

- [ ] **Step 3: Implement** the buttons (FileRow's `button` helper takes a function action already) and bind `onDiscard={(repoPath, file) => void useApp.getState().discardChanges(repoPath, file)}` in `GitPanel.tsx`.

- [ ] **Step 4: Run tests and typecheck** — `npm test && npm run typecheck`, Expected: PASS.

- [ ] **Step 5: Commit** — `feat(git): discard buttons on the CHANGES rows and header`

---

### Task 4: End to end and spec updates

**Files:**
- Modify: `e2e/git.spec.ts`; `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` (Non-goals line "Discard (reverting a change)" → note it was added, with a pointer); `docs/superpowers/specs/2026-11-24-edi-multi-repo-git-tui-design.md` (same note on the non-goal and the anti-goal).

- [ ] **Step 1: Write the e2e test** `a change is discarded from its row; Discard all resets the rest and trashes new files`

Repo `alpha` (from `makeRepo`, has a committed file), edit it, add `b.txt` committed then edited, add untracked `new.txt`. Stub `dialog.showMessageBox` to answer 0 and `shell.trashItem` to record and delete the path (as `e2e/files.spec.ts` does). Expand the repo; click `discard-file` on the first file → its row leaves CHANGES and the file has its committed text. Click `discard-all` → CHANGES is gone, `b.txt` has its committed text, the trash recorded `new.txt`'s path.

- [ ] **Step 2: Run it** — `npm run e2e -- e2e/git.spec.ts`, Expected: PASS.

- [ ] **Step 3: Update the two specs and run the whole gate** — `npm test && npm run typecheck && npm run e2e`, Expected: all PASS.

- [ ] **Step 4: Commit** — `test(git): discard end to end; note discard in the app specs`
