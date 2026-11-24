# edi — multi-repo git TUI: design

> **Note (2026-11-24):** The interface part of this document (the Ink TUI) has been
> cancelled; `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` replaced it.
> The parts about the git core still hold.

Date: 2026-11-24

## Goal and rationale

The user works in Zed: terminals on the left (one of them Claude Code), file/diff in
the center, the file explorer and git on the right. They are happy with this layout.
The one thing missing: they work with around eight repos at once, and Zed's git panel
shows one repo at a time; to see what is happening in the other repos, you have to
pick them one by one from a dropdown. They want, as in the Source Control view of
Antigravity (VS Code), **to see the status of all repos in a single list and
commit/sync from there**.

`edi` is a terminal app that stays open permanently in one of the terminal tabs in
Zed's left panel. It doesn't replace Zed; it only fills this gap.

## Goals

- Show the branch, ahead/behind and change status of all git repos in a folder on a
  single screen, live.
- Stage, commit, push, pull, fetch and switch branches without leaving the list.
- Open a file in Zed with a single key.
- Show with a mark which folder has an open Claude Code session.

## Non-goals (first version)

- AI-generated commit messages.
- Stash, merge, rebase, conflict resolution, commit history/graph.
- Line/hunk-level staging.
- Discard (reverting a change). Deliberately absent: so no work is lost to a wrong key.
- Multi-line commit body; in the first version a single-line subject is written.
- Settings file.

## Anti-goals

- Nothing goes to the remote that the user didn't ask for, and no change is deleted.
  No destructive or hard-to-undo git command (reset --hard, checkout --,
  clean, force push, rebase) is run.
- No automatic fetch/pull/push; all of them happen on a keypress.
- An error in one repo must not break the listing of the other repos.

## Constraints

- macOS, Node 24 (installed), git 2.50. No Go/Rust.
- The Zed CLI isn't on PATH; `/Applications/Zed.app/Contents/MacOS/cli` exists.
- The user's commit convention is Conventional Commits; edi doesn't validate or
  change the message, it commits exactly what was written.

## Approaches

1. **Off-the-shelf CLI (`gita`, `mgitstatus`)** — zero development, but read-only and
   not live. Rejected because the user also wants commit/sync.
2. **Custom TUI (chosen)** — a few days' work; gives the desired list and operations.
   The cost: it lives in a terminal tab, not in Zed's right dock (Zed
   extensions can't add panels).
3. **Contributing to Zed or forking it** — the panel would be exactly where it
   belongs, but getting into Rust/GPUI and keeping the fork up to date is too
   expensive for a single feature. Rejected.

The user picked 2.

## Behavior

### Launching and repo discovery

- `edi [folder]`; if no folder is given, the working directory.
- The folders **one level below** the folder that contain `.git` (a directory or a
  file, so worktrees/submodules too) are listed, sorted by name.
- If the folder itself is a git repo, only that one is shown.
- If there are no repos, it says so and exits.
- The repo list is scanned once at startup; `r` rescans it.

### Screen

```
 edi · ~/studios/quizei  ✻ 2                         ↻ 5 sn önce
 ▾ quizei-frontend        main            ✓ temiz
 ▾ ✻ quizei-app           main   ↑1       ● 3 değişiklik
     M  src/quiz/Banner.tsx              [staged]
     M  src/quiz/useAds.ts
     ?  src/quiz/banner.test.ts
 ▸ quizei-admin           main            ✓ temiz
 ▸ quizei-backend         feat/x ↓2 ↑1    ● 1 değişiklik
 ────────────────────────────────────────────────────────────────
 space stage · c commit · p push · l pull · f fetch · b branch
 enter Zed'de aç · d diff · r yenile · q çık
```

- Rows: a repo row and (if expanded) file rows beneath it. The cursor moves over both
  kinds of rows with ↑/↓ or j/k.
- Repos with changes are expanded by default, clean ones collapsed. Once the user
  expands or collapses a repo by hand, the preference for that repo is kept (for the
  session).
- If the list exceeds the terminal height, it scrolls along with the cursor.
- On a branch with no upstream, "upstream yok" ("no upstream") is shown instead of
  ahead/behind.
- On a detached HEAD, the short commit hash instead of the branch.
- New (untracked) files are listed one by one, not as folders, so that open and diff
  always apply to a file. (My call.)
- The status letter on a file row: the working-tree change's letter if there is one,
  otherwise the staged one's; a new file is `?`, a conflicted file `U`. If it is fully
  staged, a `[staged]` label; if it is partly staged, a `[kısmen]` ("partly") label.
  (My call.)
- At the very bottom, above the key help, a one-line status/error area: the result of
  the last operation or the most informative line of git's error output (the first
  line that starts with `fatal:` / `error:` or contains `[rejected]`; otherwise the
  last non-empty line). While an operation is running, an indicator like
  "push ediliyor…" ("pushing…") on the repo row.

### Claude Code indicator

The user asked for this later: to see when Claude Code is open in a terminal.

- The mark is the `✻` character, colored Claude orange (`#D97757`). The real logo
  can't be drawn in a terminal; this is a Unicode character.
- If there is a Claude Code session whose working directory is inside a repo, `✻`
  appears at the start of that repo's row (with a count, like `✻2`, if there are
  several).
- Sessions whose working directory is the scanned folder itself (or inside it but not
  in any repo) are shown on the header line:
  `edi · ~/studios/quizei  ✻ 2`. This is how the user works today: they open Claude
  Code in the repos' parent folder.
- Only that a session is **open** is shown; there is no distinction between working
  and waiting.
- Detection: processes named exactly `claude` and their working directories
  (`pgrep -x claude`, `lsof -a -d cwd -p <pids> -Fpn`). Tried on this machine, it
  takes ~20 ms. Polled about every 5 seconds. If detection fails, the mark isn't
  shown, and no error is shown either.
- The icon on Zed's own terminal tab can't be changed from edi; out of scope.

### Refreshing

- Each repo is polled with `git status` about every 2 seconds; for a given repo, a new
  poll doesn't start before the previous one finishes. After every operation, the
  affected repo is refreshed immediately.
- No file system watching (fs watch); polling is enough. (My call: because of
  node_modules noise and the complexity.)
- While running `git status`, polling must not take the index lock
  (`--no-optional-locks`), so that it doesn't collide with git commands the user or
  Claude Code runs at the same moment.

### Keys

When the cursor is on a repo row, the action applies to that repo; on a file row, to
that file or to the file's repo.

| Key | On a repo row | On a file row |
|---|---|---|
| ↑↓ / j k | move | move |
| enter | expand/collapse | open the file in Zed |
| space | stage all changes; if all are already staged, unstage all | stage/unstage the file |
| c | commit | commit in the file's repo |
| p | push | push in its repo |
| l | pull | pull in its repo |
| f / F | fetch in this repo / fetch in all repos | same |
| b | branch picker | branch picker in its repo |
| d | the repo's full diff | the file's diff |
| r | rescan the repos and refresh | same |
| q / Ctrl-C | quit | quit |

`space` on a file row: if the file has unstaged changes (or the file is new), it
stages it; if only staged changes are left, it unstages it. On a conflicted file it
does nothing, and the status line says "çakışmalı dosya; edi'de çözülemez"
("conflicted file; can't be resolved in edi"). (My call.)

### Commit

- `c` opens a single-line message input on the bottom line; enter commits, esc
  cancels. Nothing is committed with an empty message.
- If anything is staged, only the staged ones are committed.
- If nothing is staged but there are changes, it asks first: "Stage'li dosya yok.
  Tüm değişiklikler (yeni dosyalar dahil) commit edilsin mi? (e/h)" ("No files are
  staged. Commit all changes (new files included)? (y/n)"). If yes, `git add -A` +
  commit.
- If there are no changes at all, it says "commit edilecek bir şey yok" ("nothing to
  commit").
- Hooks run normally (no `--no-verify`). If a hook rejects, the error is shown.

### Push / pull / fetch

- Push: `git push`. With no upstream, `git push -u origin <branch>`; with no `origin`,
  an error is shown. No force push.
- Pull: `git pull --ff-only`. If a fast-forward isn't possible, it touches nothing and
  shows the error.
- Fetch: `git fetch`, without `--prune` (prune deletes local tracking refs; this keeps
  it in line with the anti-goals).
- Long operations don't lock the interface; only one write operation runs at a time in
  the same repo.
- A git command that tries to ask for credentials must not take over the terminal: the
  interactive prompt is turned off (`GIT_TERMINAL_PROMPT=0`), and if the command fails,
  the error is shown. The user's credential helper / SSH agent works normally.

### Branch

- `b` opens a picker listing the repo's local branches (the current one marked).
  enter runs `git switch <branch>`; `n` asks for a new branch name and runs
  `git switch -c`; esc closes it.
- Remote-only branches aren't listed in the first version.
- If git refuses the switch because of uncommitted changes, the error is shown; it
  isn't forced.

### Diff

- `d` opens a full-screen, scrollable, colored diff view (additions green, deletions
  red). esc or q returns to the list.
- For a file: staged and unstaged changes together (against HEAD). For a new
  (untracked) file: the whole file as additions. For a repo: the diff of all changes,
  new files included.
- Also works in a repo with no commits yet (diff against the empty tree).
- A reliable way to trigger Zed's own diff view from outside hasn't been verified;
  it's not in the scope of the first version.

### Opening in Zed

- Try in order: `zed` on PATH; otherwise `/Applications/Zed.app/Contents/MacOS/cli`;
  failing that, `open -a Zed <file>`. If all of them fail, say so on the error line.
- On a deleted file, enter does nothing (the status line says "dosya silinmiş"
  ("file deleted")).

## Technical decisions (my calls, approved by the user)

- TypeScript + Ink (React for the terminal). Requires installing nothing besides Node.
- Git operations directly through the `git` CLI (no library); status is read with
  `git status --porcelain=v2 --branch -z`.
- The code lives in `~/studios/edi`; the `edi` command is made global with `npm link`.
- Tests: the git layer with real repos in temporary directories (a local bare repo for
  the remote), the status output parser with unit tests, the interface's main flows
  with ink-testing-library.

## Left to the implementer

- File/module structure, state management, component split.
- Colors, column alignment, truncation of long names.
- Test framework and build setup (tsc/tsx etc.).
- The exact poll interval and the concurrency limit.
