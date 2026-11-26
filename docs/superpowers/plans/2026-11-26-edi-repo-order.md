# Repository Order and Ignore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per project, put the repos found in its folder in the user's order and leave ignored ones out of edi entirely, set from a REPOSITORIES section in the New/Edit project sheet.

**Architecture:** A project stores `repos: { order, ignored }` (folder names). One pure function in `src/shared/projects.ts` arranges a found list by those settings; the main process's `Workspace` applies it where it discovers repos (open and rescan), so the Git, History and Files tabs, the status bar, auto-fetch and the repo count all follow. The sheet lists every repo found, with a drag handle and a checkbox, and sends the settings with Create/Save; Save on the open project re-applies them at once.

**Tech Stack:** TypeScript, Electron (main + preload IPC), React + zustand renderer, vitest (+ jsdom, Testing Library), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-26-edi-repo-order-design.md`

## Global Constraints

- Settings are folder names of repos one level below the project's folder, never paths.
- Arranged order: names in `order` first, in that order; then every other found repo alphabetically (`localeCompare`, as `discoverRepos` does); names in `ignored` dropped; names that no longer exist skipped.
- A project folder that is itself a repo is never arranged: settings don't apply, the sheet shows no REPOSITORIES section.
- The REPOSITORIES section sits **before LINKS** in the sheet, shown only when the folder holds more than one repo.
- Ignored rows: unticked, dimmed, marked `ignored`. Reorder by dragging the handle or ⌥↑/⌥↓ on a focused row.
- `repoCount` (card, title bar menu, sheet) counts the kept repos.
- Projects in old state files have no `repos`: alphabetical, nothing ignored.
- Code comments, tests and docs in English. Conventional Commits; footer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A project whose folder is itself a repo, with settings that name it as ignored (hand-edited state, or the folder later became a repo): the repo must still show. Test in Task 2.
2. Repos renamed or deleted on disk: stale names in `order`/`ignored` are skipped; a new repo shows at the end, kept. Tests in Tasks 1 and 2.
3. Every repo ignored: the workspace is empty (0 repos), nothing crashes, and the sheet still lists them all so they can be ticked back. Tests in Tasks 2 and 3.
4. A hand-edited or old state file: `repos` missing, not an object, arrays of non-strings, names with `/`, `.` or `..`, duplicates, huge lists — normalized, never a crash. Test in Task 1.
5. Ignoring a repo that has a diff or file tab open, or is the History filter: the tab closes and the filter resets (the existing `syncCenter` / `keepHistory` on a workspace update do this). Assertion in Task 4's e2e.

---

### Task 1: Settings type, arranging, and validation

**Files:**
- Modify: `src/shared/api.ts` (`Project`, `ProjectDraft`, `ProjectInput`; new `RepoSettings`)
- Modify: `src/shared/projects.ts` (new `NO_REPO_SETTINGS`, `orderRepos`, `arrangeRepos`, `MAX_REPO_NAMES`)
- Modify: `src/main/projects.ts` (`repoSettingsOf`, `normalizeProjects`, `defaultProject`, `ProjectTemplate`, `cleanInput`/`CleanInput`)
- Test: `tests/projects.test.ts`

**Interfaces:**
- Produces:
  - `interface RepoSettings { order: string[]; ignored: string[] }` in `src/shared/api.ts`
  - `Project.repos: RepoSettings`; `ProjectInput.repos: RepoSettings`; `ProjectDraft.repoNames: string[]` (every repo found one level down, alphabetical; `[]` when the folder itself is a repo or is missing). `ProjectDraft.repoCount` stays: all repos found.
  - `const NO_REPO_SETTINGS: RepoSettings` (`{ order: [], ignored: [] }`, frozen) and `const MAX_REPO_NAMES = 500` in `src/shared/projects.ts`
  - `orderRepos<T extends { name: string }>(found: T[], order: string[]): T[]` — all found, `order` first, the rest alphabetical
  - `arrangeRepos<T extends { name: string }>(found: T[], settings: RepoSettings): T[]` — `orderRepos` minus `ignored`
  - `repoSettingsOf(raw: unknown): RepoSettings` in `src/main/projects.ts` — exported, used by `normalizeProjects` and `cleanInput`
  - `ProjectTemplate = Pick<Project, 'id' | 'name' | 'logo' | 'links' | 'repos'>`; `CleanInput` gains `repos`

- [ ] **Step 1: Write the failing tests** in `tests/projects.test.ts`, a new `describe('repository settings')`:

```ts
const found = ['next-quiz', 'quizei-admin', 'quizei-api', 'quizei-frontend'].map((name) => ({ name }));
const names = (list: { name: string }[]) => list.map((r) => r.name);

it('puts the ordered names first, then the others alphabetically, skipping names that are gone', () => {
  expect(names(orderRepos(found, ['quizei-frontend', 'gone', 'quizei-api']))).toEqual(['quizei-frontend', 'quizei-api', 'next-quiz', 'quizei-admin']);
});

it('drops the ignored ones; with nothing set the order is alphabetical', () => {
  expect(names(arrangeRepos(found, { order: ['quizei-frontend'], ignored: ['next-quiz', 'gone'] }))).toEqual(['quizei-frontend', 'quizei-admin', 'quizei-api']);
  expect(names(arrangeRepos(found, NO_REPO_SETTINGS))).toEqual(names(found));
  expect(arrangeRepos(found, { order: [], ignored: names(found) })).toEqual([]);
});

it('reads settings from the state file: names only, each once, nothing else', () => {
  expect(repoSettingsOf(undefined)).toEqual({ order: [], ignored: [] });
  expect(repoSettingsOf('x')).toEqual({ order: [], ignored: [] });
  expect(repoSettingsOf({ order: ['a', 'a', 3, '', ' b ', 'c/d', '.', '..'], ignored: 'a' })).toEqual({ order: ['a', 'b'], ignored: [] });
  expect(repoSettingsOf({ order: Array.from({ length: 600 }, (_, i) => `r${i}`), ignored: [] }).order).toHaveLength(MAX_REPO_NAMES);
});
```

Extend the existing tests: `'keeps valid fields and drops broken ones'` expects `repos` normalized (an entry with `repos: { order: ['b', 'a'], ignored: ['a'] }` keeps it; one without gets `{ order: [], ignored: [] }`); `'marks the project opened…'` expects a template's `repos` carried into the added project and `defaultProject` to give `NO_REPO_SETTINGS`-equal settings; the `cleanInput` tests expect `repos` passed through `repoSettingsOf` (missing `repos` → empty settings, not a refusal).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/projects.test.ts`
Expected: FAIL — `orderRepos` / `arrangeRepos` / `repoSettingsOf` not exported.

- [ ] **Step 3: Implement**

Add the types and functions above. `repoSettingsOf` trims each name, drops non-strings, empty names, names containing `/` or `\`, `.` and `..`, duplicates, and stops at `MAX_REPO_NAMES` per list. Add `repos` to every `Project` built in `src/main/projects.ts` (`normalizeProjects` via `repoSettingsOf(item.repos)`, `defaultProject` with a fresh `{ order: [], ignored: [] }`). Fix the compile errors this causes in fixtures (`tests/renderer/*` `ProjectView`/`ProjectDraft` objects get `repos: { order: [], ignored: [] }` / `repoNames: []`) and in `src/main/ipc.ts` (`draftFor` and the missing-folder draft in `projectDraft` return `repoNames`; `createProject` passes `repos: clean.input.repos` into the template; `updateProject` writes `repos` along with `name` and `links`) — the live behavior of those comes in Task 4, here they only need to type-check.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/projects.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared src/main/projects.ts src/main/ipc.ts tests
git commit -m "feat(projects): keep a repo order and ignored repos per project"
```

### Task 2: The workspace arranges what it finds

**Files:**
- Modify: `src/main/workspace.ts`
- Test: `tests/workspace.test.ts`

**Interfaces:**
- Consumes: `RepoSettings`, `NO_REPO_SETTINGS`, `arrangeRepos` (Task 1)
- Produces:
  - `Workspace.open(dir: string, repos?: RepoSettings): Promise<OpenWorkspaceResult>` — `repoCount` is the kept count
  - `Workspace.setRepoSettings(repos: RepoSettings): Promise<void>` — stores them, rescans, emits the new view

- [ ] **Step 1: Write the failing tests** in `tests/workspace.test.ts` (use the file's `makeTmpDir`, `initRepo`, `makeWorkspace`):

```ts
it('lists the repos in the project order without the ignored ones, and counts only those', async () => {
  // repos a, b, c, d (commit: true)
  expect(await ws.open(dir, { order: ['c'], ignored: ['b'] })).toEqual({ ok: true, repoCount: 3 });
  expect(ws.view().repos.map((r) => r.name)).toEqual(['c', 'a', 'd']);
});

it('new settings apply at once and keep the state of the repos that stay', async () => {
  // open with defaults, ws.setBusy(join(dir, 'a'), 'Pushing…')
  await ws.setRepoSettings({ order: ['b', 'a'], ignored: ['c'] });
  expect(ws.view().repos.map((r) => [r.name, r.busy])).toEqual([['b', null], ['a', 'Pushing…'], ['d', null]]);
  expect(ws.repo(join(dir, 'c'))).toBeNull();
  // onChange was called with this view
});

it('a repo made later shows at the end; one ignored is never read', async () => {
  // open with { order: ['b', 'a'], ignored: ['c'] }; initRepo(dir, 'e'); rescan
  expect(ws.view().repos.map((r) => r.name)).toEqual(['b', 'a', 'd', 'e']);
});

it('a folder that is itself a repo shows, whatever the settings say', async () => {
  // dir = initRepo(parent, 'solo')
  await ws.open(dir, { order: [], ignored: ['solo'] });
  expect(ws.view().repos.map((r) => r.name)).toEqual(['solo']);
});

it('with every repo ignored, the folder opens with none', async () => {
  expect(await ws.open(dir, { order: [], ignored: ['a', 'b', 'c', 'd'] })).toEqual({ ok: true, repoCount: 0 });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/workspace.test.ts`
Expected: FAIL — `setRepoSettings` missing, order alphabetical.

- [ ] **Step 3: Implement**

Keep the settings in a private field (reset to `NO_REPO_SETTINGS` in `open` when none are given). One private `find(dir)` used by `open` and `rescan`: `discoverRepos(dir)`, returned as is when it is the folder itself (`length === 1 && found[0].path === dir`), else `arrangeRepos(found, this.repoSettings)`. `setRepoSettings` stores, awaits `rescan()`, then emits (the class's existing emit). Ignored repos are never polled or fetched because they are never in `this.repos`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/workspace.test.ts tests/discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace.ts tests/workspace.test.ts
git commit -m "feat(workspace): list repos in the project's order, leaving ignored ones out"
```

### Task 3: REPOSITORIES in the project sheet

**Files:**
- Create: `src/renderer/projects/RepoList.tsx`
- Modify: `src/renderer/projects/ProjectSheet.tsx`
- Modify: `src/renderer/projects/projects.css`
- Test: `tests/renderer/ProjectSheet.test.tsx`

**Interfaces:**
- Consumes: `ProjectDraft.repoNames`, `Project.repos`, `ProjectInput.repos`, `orderRepos` (Task 1)
- Produces:
  - `interface RepoRow { name: string; kept: boolean }`
  - `RepoList({ rows, onChange }: { rows: RepoRow[]; onChange(rows: RepoRow[]): void })` — the section's rows; the sheet owns the state
  - `rowsFor(names: string[], settings: RepoSettings): RepoRow[]` and `settingsOf(rows: RepoRow[]): RepoSettings` (`order` = every row's name in row order, `ignored` = the unticked ones), exported from `RepoList.tsx`

- [ ] **Step 1: Write the failing tests** in `tests/renderer/ProjectSheet.test.tsx` (`draft.repoNames` defaults to `[]` in the fixture; these tests pass four):

```ts
const four = ['next-quiz', 'quizei-admin', 'quizei-api', 'quizei-frontend'];
const rows = () => screen.getAllByTestId('repo-row').map((row) => row.textContent);

it('lists the repos before the links, in the project order with the ignored ones unticked', () => {
  openEdit({ repos: { order: ['quizei-frontend'], ignored: ['next-quiz'] } }, { repoNames: four });
  const labels = [...document.querySelectorAll('.sheet-label')].map((el) => el.textContent);
  expect(labels.indexOf('REPOSITORIES')).toBeLessThan(labels.findIndex((t) => t?.startsWith('LINKS')));
  expect(rows()).toEqual(['quizei-frontend', 'next-quizignored', 'quizei-admin', 'quizei-api']);
  expect((screen.getByRole('checkbox', { name: 'Keep next-quiz' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByTestId('sheet-folder').parentElement!.parentElement!.textContent).toContain('4 git repositories found · 1 ignored');
});

it('⌥↑ and ⌥↓ move a repo; unticking ignores it; Save sends the order and the ignored ones', async () => {
  openEdit({}, { repoNames: four });
  fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Keep quizei-frontend' }), { key: 'ArrowUp', altKey: true });
  // …three times, to the top
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep next-quiz' }));
  await submit();
  expect(bridge.edi.updateProject).toHaveBeenCalledWith('quizei', expect.objectContaining({
    repos: { order: ['quizei-frontend', 'next-quiz', 'quizei-admin', 'quizei-api'], ignored: ['next-quiz'] },
  }));
});

it('dragging a repo by its handle drops it where it is let go', () => {
  // fireEvent.dragStart on the handle of 'quizei-frontend', dragOver + drop on the 'next-quiz' row
  expect(rows()[0]).toBe('quizei-frontend');
});

it('every repo can be ignored, and ticked back', () => {
  // untick all four: still listed, note says "4 git repositories found · 4 ignored"; tick one back
});

it('no section for a folder that is itself a repo, or holds one; a new folder starts with all kept', async () => {
  openNew({ repoNames: [] });
  expect(screen.queryByText('REPOSITORIES')).toBeNull();
  // openNew({ repoNames: four }); Change… returns a draft with ['x', 'y']: rows are x, y, both kept
});
```

`openEdit` gains a second parameter `draftOver: Partial<ProjectDraft>` merged into its draft.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/renderer/ProjectSheet.test.tsx`
Expected: FAIL — no REPOSITORIES section.

- [ ] **Step 3: Implement**

`RepoList` renders a `role="group"` labelled by a `REPOSITORIES` `.sheet-label`, one `data-testid="repo-row"` per row: a `GripVertical` (lucide-react) handle button (`aria-label="Move {name}"`, `draggable`), a checkbox (`aria-label="Keep {name}"`), the name in mono, and `ignored` in a muted tag on unticked rows (row gets `.is-ignored`, dimmed). ⌥↑/⌥↓ on any focused element of a row moves it one place and keeps the focus on the moved row. HTML5 drag: `dragstart` on the handle remembers the index, `dragover` on a row calls `preventDefault`, `drop` moves the dragged row to that index. In `ProjectSheet`: state `repoRows` from `rowsFor(draft.repoNames, start?.repos ?? NO_REPO_SETTINGS)`; on Change… reset to `rowsFor(next.repoNames, NO_REPO_SETTINGS)`; render `RepoList` in its own `.sheet-field` right before the LINKS field when `draft.repoNames.length > 1`; send `repos: settingsOf(repoRows)` with Create and Save (`NO_REPO_SETTINGS` when the section isn't shown). The FOLDER note appends ` · N ignored` when N > 0.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/projects tests/renderer/ProjectSheet.test.tsx
git commit -m "feat(projects): order and ignore repos from the project sheet"
```

### Task 4: Open with the settings, apply them on Save

**Files:**
- Modify: `src/main/ipc.ts` (`openFolderNow`, `draftFor`, `updateProject`)
- Modify: `docs/superpowers/specs/2026-11-25-edi-projects-design.md` (one line under "The New project and Edit project sheet" pointing to the new spec)
- Test: `e2e/projects.spec.ts`

**Interfaces:**
- Consumes: `Workspace.open(dir, repos)`, `Workspace.setRepoSettings(repos)` (Task 2); `ProjectTemplate.repos`, `ProjectDraft.repoNames` (Task 1); the sheet's `repos` (Task 3)

- [ ] **Step 1: Write the failing e2e test** in `e2e/projects.spec.ts`, with the file's helpers (`tmpDir`, `makeRepo`, `launch`):

```ts
test('Edit project… orders the repos and ignores one: the Git tab follows at once and after a restart', async () => {
  // one folder with repos next-quiz, quizei-api, quizei-frontend; launch({ openDir })
  // open a file tab of next-quiz in the center first (click a changed file's row) and pick next-quiz in the History filter
  // title bar menu → Edit project…; in the sheet: ⌥↑ twice on 'Keep quizei-frontend', untick 'Keep next-quiz', Save
  await expect(page.locator('[data-testid="repo-row"]')).toHaveText([/quizei-frontend/, /quizei-api/]);
  await expect(page.getByTestId('center-tab')).toHaveCount(0);
  // status bar says 2 repositories; the title bar menu says 2 repos
  // close, relaunch with the same userData and openDir: same two rows in the same order
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run build && npx playwright test e2e/projects.spec.ts -g "orders the repos"`
Expected: FAIL — three rows, alphabetical.

- [ ] **Step 3: Implement**

`draftFor`: `repoNames` = the found names unless the folder itself is a repo. `openFolderNow`: pass `template?.repos ?? this.projectFor(<the real folder>)?.repos` to `workspace.open` (projects store real paths; resolve the folder first as `openFolder` already does with `resolve(dir)` / `realDir`). `updateProject`: when the project is open and its `repos` changed, `await this.workspace.setRepoSettings(repos)`, send `workspace`, and store `repoCount: this.workspace.view().repos.length` with the rest of the change.

- [ ] **Step 4: Run the e2e suite for projects and git, and the unit tests**

Run: `npm run build && npx playwright test e2e/projects.spec.ts e2e/git.spec.ts e2e/history.spec.ts && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts e2e/projects.spec.ts docs/superpowers
git commit -m "feat(projects): open a project with its repo order and apply changes on Save"
```
