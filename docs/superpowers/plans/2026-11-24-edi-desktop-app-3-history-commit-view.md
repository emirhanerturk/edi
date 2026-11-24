# edi desktop app — plan 3: History tab and commit view

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A History tab in the right panel lists the recent commits of every repository's current branch in one timeline (or grouped by repo); clicking a commit opens it in the center panel with every changed file's diff.

**Architecture:** `src/git/log.ts` reads a repo's log with an unambiguous record format, and `src/git/commit.ts` reads one commit's metadata, file list and patch. The main process validates repo path, count and commit id before running git (`HistoryOps`). The renderer merges the per-repo logs into a timeline with pure functions (`src/renderer/history/model.ts`) — day groups, the "no false gaps" boundary, release rows, unpushed marks — and renders the History tab and a commit view built on plan 2's diff parser, highlighter and center tabs.

**Tech Stack:** as plan 2. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` (sections "History", "Orta panel → Commit görünümü", "Teknik kararlar"). Visual source: `docs/design/edi-ui/History.dc.html`, `HistoryStates.dc.html`.

Plan 3 of 4. It builds on plan 2 (branch `feat/center-panel`); work happens on `feat/history`, branched from it.

## Global Constraints

All constraints of plans 1 and 2 hold. In addition:

- Read-only: `git log`, `git show`, `git rev-list`, `git rev-parse`, `git config --get`. Nothing here changes a repository or touches the network.
- A commit id from the page must match `^[0-9a-f]{7,64}$` and resolve with `rev-parse --verify --end-of-options <id>^{commit}` in that repo; anything else is refused before git sees it as an argument.
- A log count from the page is an integer, a multiple of 50, between 50 and 5000.
- Git output that user config could change is pinned: `-c log.showSignature=false -c color.ui=false -c core.quotePath=false`, `--no-color`, `--no-ext-diff`, `--no-textconv`, explicit `--format`.
- Per repo: 50 commits per page (`PAGE = 50`). Commit view: a file whose diff has more than 400 lines starts collapsed (`COLLAPSE_LINES = 400`); an expanded file draws at most `MAX_DIFF_LINES` (5,000) lines.
- Times use the committer date. Day headers: `TODAY`, `YESTERDAY`, `THIS WEEK` (the five days before yesterday), then one header per day as `NOV 12` (`NOV 12, 2025` in another year). Short relative time in rows: `now`, `25m`, `3h`, `2d`, `3w`, `5mo`, `2y`; long form in the commit view and By repo notes: `just now`, `25 minutes ago`, `1 hour ago`, `yesterday`, `5 days ago`, `2 weeks ago`, `last month`, `3 months ago`, `last year`, `2 years ago`.
- By repo: a repo is "recent" (open, last three commits shown) when its newest commit is less than 3 days old.

## Review Focus

1. A commit id or count from the page that is not hex, too short or long, an option (`--output=x`), a tree or blob id, or unknown to the repo is refused without git running it as an argument. → Task 3 tests.
2. User config that changes log or show output (`log.showSignature=true`, `format.pretty`, `log.decorate=full`, `color.ui=always`, `diff.noprefix`, `diff.external`, a textconv driver) does not break parsing. → Task 1 and Task 2 tests.
3. The merged timeline never shows a false gap: with a busy repo and a quiet one, commits older than the newest "oldest loaded" commit of a repo that has more are hidden; "Load 50 more" moves that boundary back; fully loaded repos do not set it. → Task 4 tests.
4. Odd commits — empty or very long subject, multi-line body, merge commit (first-parent diff), root commit, rename, deletion, mode-only change, binary file, a path with spaces / non-ASCII / leading `-`, hundreds of files — render without crashing and big diffs start collapsed. → Task 2 and Task 6 tests.
5. A repo with no commits, a detached HEAD, a branch without upstream (with and without a remote), a deleted upstream and a shallow clone give sensible rows and no false "not pushed" arrows. → Task 1 and Task 4 tests.

---

### Task 1: Read a repository's log

**Files:** Create `src/git/log.ts`, `tests/log.test.ts`. Modify `src/git/types.ts`.

**Interfaces (produces):**

```ts
// git/types.ts
export interface CommitSummary {
  oid: string; short: string; subject: string;
  authorName: string; authorEmail: string;
  /** Committer date, epoch ms. */
  date: number;
  parents: number;
  tags: string[];
}
export type LogResult =
  | { ok: true; commits: CommitSummary[]; hasMore: boolean; unpushed: string[]; upstream: string | null; userEmail: string | null }
  | { ok: false; error: string };
// git/log.ts
export const PAGE = 50;
export function parseLog(out: string): CommitSummary[];
export function readLog(repo: string, count: number): Promise<LogResult>;
```

- `git log -z --format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%D%x1f%s -n <count+1> HEAD` with the pinned `-c` options and `--decorate=short`; `hasMore` when `count+1` came back. Tags come from `tag: …` items of `%D`.
- `unpushed`: with an upstream, `rev-list HEAD ^@{u}`; without one but with a remote, `rev-list HEAD --not --remotes`; with no remote, `[]`. Limited to the loaded commits (`-n count+1`).
- `upstream` from `rev-parse --abbrev-ref --symbolic-full-name @{u}` (null when none or gone); `userEmail` from `config --get user.email` (null when unset).
- An unborn repo returns `{ ok: true, commits: [], hasMore: false, unpushed: [], upstream: null, userEmail }`.

- [ ] **Step 1: failing tests** — `parseLog` on a hand-made record (tags, merge parents, subject with `:` and unicode, empty subject); `readLog` on temp repos: order newest first, `hasMore` true at 3 commits with count 2 and false at count 3; a tag and an annotated tag on commits; a merge has `parents: 2`; unborn repo; detached HEAD; with a bare remote and upstream: one local commit → `unpushed` has exactly it, `upstream: 'origin/main'`; branch without upstream but with a remote whose `main` holds the first commit → only newer commits unpushed; no remote → `[]`; upstream deleted (`branch.main.merge` pointing at a missing ref) → `upstream: null` and no crash; `user.email` read; repo config `log.showSignature=true`, `format.pretty=oneline`, `log.decorate=full`, `color.ui=always` → same parse; a shallow clone (`clone --depth 2 file://…`) lists its 2 commits.
- [ ] **Step 2:** run `npx vitest run tests/log.test.ts` — FAIL (module missing).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat(git): read a repository's recent commits`.

### Task 2: Read one commit

**Files:** Create `src/git/commit.ts`, `tests/commit.test.ts`. Modify `src/git/types.ts`, `src/git/diffParse.ts` (export a splitter if needed).

**Interfaces (produces):**

```ts
export interface CommitFile { path: string; origPath: string | null; letter: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'; diff: ParsedDiff }
export interface CommitDetail extends CommitSummary { body: string; files: CommitFile[]; added: number; removed: number }
export type CommitResult = { ok: true; commit: CommitDetail } | { ok: false; error: string };
export function splitPatch(text: string): string[];            // one chunk per `diff --git` section, in order
export function readCommit(repo: string, oid: string): Promise<CommitResult>;   // oid already validated and full
```

- Metadata: `show -s --format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%D%x1f%s%x1f%b <oid>`. Files: `show --format= -z --name-status -M --diff-merges=first-parent <oid>`. Patch: `show --format= -p -M --diff-merges=first-parent --no-color --no-ext-diff --no-textconv <oid>` split with `splitPatch` and zipped by index with the name-status list; if the counts differ → `{ ok: false, error: 'Could not read this commit' }`.
- `added` / `removed` are the sums over files.

- [ ] **Step 1: failing tests** — `splitPatch` on a two-file patch, a patch whose content line starts with `diff --git` inside a hunk (must not split: only split at a line that follows a hunk's end or the start), empty text; `readCommit`: a normal commit with body (multi-line) and two files (+/− sums); root commit (all `A`); merge commit (only the first-parent changes); rename with edits (`R`, `origPath`); deletion; mode-only change (`M`, no hunks); binary file (`binary: true`); paths `boş klasör/-tuhaf ö.txt`; empty subject (`commit --allow-empty-message -m ''`); `diff.noprefix=true`, `diff.external=false`-style config and a textconv driver in repo config → same files and counts.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat(git): read one commit's files and diffs`.

### Task 3: History over the bridge

**Files:** Create `src/main/historyOps.ts`, `tests/historyOps.test.ts`. Modify `src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/preload.cts`.

**Interfaces (produces):**

```ts
// EdiApi additions
log(repoPath: string, count: number): Promise<LogResult>;
commit(repoPath: string, oid: string): Promise<CommitResult>;
// main/historyOps.ts
export class HistoryOps {
  constructor(ws: Workspace);
  log(repoPath: unknown, count: unknown): Promise<LogResult>;
  commit(repoPath: unknown, oid: unknown): Promise<CommitResult>;
}
```

- Errors: `Unknown repository`, `Invalid count`, `Invalid commit`, `Commit not found`.

- [ ] **Step 1: failing tests** — unknown / non-string repo refused for both; counts `0`, `49`, `51`, `5050`, `1.5`, `'50'`, `NaN` refused, `50` and `100` accepted; commit ids `''`, `'abc'` (too short), `'--output=/tmp/x'`, `'HEAD'`, `'g'.repeat(40)`, a tree id, a blob id refused; an unknown hex id → `Commit not found`; a short id of a real commit resolves and returns the full oid.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement; register `history:log`, `history:commit`.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat: history and commit reading over the bridge`.

### Task 4: Timeline model

**Files:** Create `src/renderer/history/model.ts`, `src/renderer/history/time.ts`, `tests/renderer/historyModel.test.ts`, `tests/renderer/time.test.ts`.

**Interfaces (produces):**

```ts
// time.ts
export function shortAgo(then: number, now: number): string;
export function longAgo(then: number, now: number): string;
export function dayLabel(then: number, now: number): string;          // local time zone
export function splitSubject(subject: string): { prefix: string; rest: string };  // 'feat(x): ' prefix only when ': ' is within the first 32 chars
// model.ts
export interface RepoLog { repo: { name: string; path: string; ahead: number }; log: LogResult & { ok: true } }
export type HistoryRow =
  | { type: 'day'; label: string; first: boolean }
  | { type: 'commit'; repoName: string; repoPath: string; commit: CommitSummary; unpushed: boolean; author: string | null; merge: boolean; tag: string | null }
  | { type: 'release'; repoName: string; repoPath: string; commit: CommitSummary; tag: string }
  | { type: 'remote'; upstream: string };
export function boundary(logs: RepoLog[]): number | null;
export function timeline(logs: RepoLog[], now: number, opts: { single: boolean }): HistoryRow[];
export interface RepoGroup { repoName: string; repoPath: string; ahead: number; open: boolean; latest: number | null; commits: CommitSummary[] }
export function byRepo(logs: RepoLog[], now: number): RepoGroup[];
export function isRelease(subject: string, tag: string): boolean;     // '1.86.0' ↔ 'v1.86.0', 'v1.86.0' ↔ 'v1.86.0'
```

- `boundary`: over repos with `hasMore`, the newest of their oldest loaded commit dates; `null` when none has more. `timeline` drops commits older than it, sorts all by date (newest first; ties keep each repo's own order), inserts day rows, makes a release row when a tag matches the subject (`isRelease`), otherwise passes the first tag as a badge; `author` is the author name when the email differs from the repo's `userEmail` (case-insensitive), else null; `merge` when `parents > 1`. With `single`, a `remote` row goes between the last unpushed and the first pushed commit when the repo has an upstream and both kinds are present.
- `byRepo`: groups ordered by newest commit (repos without commits last, by name); `open` when the newest commit is less than 3 days old; `commits` the first three.

- [ ] **Step 1: failing tests** — time formatters at the boundaries listed in Global Constraints (59 s, 60 s, 59 m, 23 h, 47 h, 13 d, 31 d, 364 d, 2 y; day labels across midnight, the week edge and a previous year); `splitSubject` (conventional, scope with `!`, `Merge pull request …`, a `: ` after 32 chars, empty); boundary with a busy repo (50 commits over 2 days, hasMore) and a quiet repo (5 commits over 3 months, no more) → quiet repo's old commits hidden; after "load more" (100 commits reaching back 4 days) → boundary moves back; both fully loaded → null; timeline rows for the artboard's data (day headers, release rows `v1.86.0`, unpushed arrow, `dependabot` author, merge dim); single mode with the `remote` row; no upstream → no `remote` row; unborn repo (empty log) contributes nothing; byRepo order, open/closed, three commits.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat: merge repository logs into one timeline`.

### Task 5: History tab

**Files:** Create `src/renderer/history/HistoryPanel.tsx`, `src/renderer/history/RepoFilter.tsx`, `src/renderer/history/history.css`, `tests/renderer/HistoryPanel.test.tsx`. Modify `src/renderer/right/RightPanel.tsx`, `src/renderer/store.ts`, `src/renderer/components/icons.tsx`, `tests/renderer/RightPanel.test.tsx`.

**Interfaces:**

- Store: `history: Record<string, { limit: number; key: string; log: LogResult | null }>`, `historyFilter: string | null`, `loadHistory(repoPath, limit?)`, `loadMoreHistory()`, `refreshHistory()`, `setHistoryFilter(path | null)`, `setHistoryLayout(layout)` (saved through `setLayout`). A repo's log reloads (same limit) when its `headOid`, `upstream`, `ahead` or `behind` changes; logs of vanished repos are dropped; a folder change clears everything.
- `HistoryPanelView` props: `{ rows | groups, layout, filter, repos, canLoadMore, selected, onOpenCommit(repoPath, oid, pin), onFilter, onLayout, onLoadMore, onToggleGroup }` — the toolbar (filter menu, branch chip in single mode, `Timeline / By repo`), rows per the artboards (46 px commit rows, 28 px day headers, 30 px release rows, 26 px remote line), `Load 50 more` at the end when any shown repo has more, `No commits yet` for an empty list, `Loading…` while the first logs load, a red note for a repo whose log failed.
- RightPanel: tabs `Git`, `History`, `Files`; History header button `Refresh history`.

- [ ] **Step 1: failing tests** — rows render subject with dim prefix, repo name, short time, hash, the not-pushed arrow (`aria-label="Not pushed yet"`), author, release row; single mode hides repo names and shows the `origin/main` line and the branch chip; clicking a commit calls `onOpenCommit(…, false)`, double click `…, true`; the selected commit row has `aria-current`; layout buttons `aria-pressed`; By repo groups open/closed with the long-time note and `↑1`; `Load 50 more` only when `canLoadMore`; RightPanel shows three tabs and the refresh button on History.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat: History tab with timeline and by-repo layouts`.

### Task 6: Commit view

**Files:** Create `src/renderer/center/CommitPane.tsx`, `src/renderer/center/CommitView.tsx`, `tests/renderer/CommitPane.test.tsx`. Modify `src/renderer/center/tabs.ts` (`kind: 'commit'`, `path` holds the oid), `src/renderer/center/CenterTabs.tsx`, `src/renderer/center/CenterPanel.tsx`, `src/renderer/center/center.css`, `src/renderer/highlight/highlight.ts` (reuse `highlightDiff` per file), `tests/renderer/centerTabs.test.ts`, `tests/renderer/CenterPanel.test.tsx`.

**Interfaces:**

- `CommitPane` props `{ repoName: string; branch: string | null; result: CommitResult | null; now: number; tokens: Map<string, DiffTokens>; onCopy(): void; onOpenFile?(path): void }`. Header: `<h1>` subject with dim prefix, body paragraphs (blank-line separated), repo, branch chip, long relative time, `+N −N`, short hash button `Copy hash`. Files: one section per file — a header button (chevron, letter in its color, folder + name, `+N −N`) toggling an inline diff (old / new line numbers 34 px each, marker 22 px); diffs over 400 lines start collapsed; binary → `Binary file`; no hunks → `No content changes`; renamed → `Renamed from …`.
- Tab label for a commit: commit icon + short hash. Status bar: `N files changed`.

- [ ] **Step 1: failing tests** — header fields; body paragraphs; copy button calls `onCopy`; two files render with their diffs, a 401-line file starts collapsed and opens on click, a 400-line one starts open; binary / mode-only / renamed notes; error result shows the error; loading shows no file sections; center tab reducer with `kind: 'commit'` (same rules); tab strip shows the short hash for a commit tab.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** implement; History rows open commits through `openInCenter({ kind: 'commit', repoPath, path: oid }, pin)`.
- [ ] **Step 4:** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5:** commit `feat: open a commit from History in the center panel`.

### Task 7: End-to-end, screenshots, README

**Files:** Create `e2e/history.spec.ts`. Modify `README.md`.

- [ ] **Step 1:** e2e `'History sekmesi tüm repoların commit'lerini gösterir'`: two repos with commits at different times (`GIT_COMMITTER_DATE`), one unpushed commit on a repo with a bare remote → History tab lists both repos' subjects newest first under day headers, the arrow on the unpushed one; By repo layout survives a relaunch; filter to one repo shows the `origin/main` line; clicking a commit opens the commit view with its files and `+/−`; a new commit made from the terminal side (`git commit` in the test) appears after the next poll.
- [ ] **Step 2:** `npm run typecheck && npm test && npm run e2e` — PASS; screenshot with the demo repos, compare with `History.dc.html`.
- [ ] **Step 3:** README: History tab and commit view; planned next line.
- [ ] **Step 4:** commit `docs: describe the History tab and the commit view`.
