# Discard changes

2026-11-26, requested by the user. A small change.

## Why

The user wants to throw away changes they don't want straight from the Git tab, the way VS Code and
Antigravity do: the change is removed directly, not saved anywhere first (user: no stash). This
lifts the "Discard (reverting a change)" non-goal and softens the "no change is deleted" anti-goal
in `2026-11-24-edi-multi-repo-git-tui-design.md` and `2026-11-24-edi-desktop-app-design.md`.

## Goals

- **Per file:** every row in CHANGES gets a discard button (↶), left of the stage button, as in VS Code.
- **All:** the CHANGES header gets a "Discard all changes" button next to "Stage all".
- STAGED gets nothing new: as in VS Code, its rows only unstage (my call).
- **Tracked files** (modified, deleted): `git restore --worktree -- :(literal)<path>`. A partly staged
  file loses only its unstaged part; the staged part stays (my call, matches VS Code).
- **New (untracked) files** go to the Trash (`shell.trashItem`), like Move to Trash in the Files tab,
  not deleted for good and never `git clean` (my call: still direct for the user, but a file thrown
  away by mistake can be fished out).
- **Asks first** with a native dialog (my call, VS Code asks too):
  - one tracked file: `Discard changes to <name>?`, detail `This can't be undone.`
  - one new file: `Move <name> to the Trash?`, detail `It is new, so git has no copy of it.`
  - all: `Discard all changes in <repo>?`, detail naming the counts, e.g. `3 changed files are reset
    and 2 new files go to the Trash. Staged changes stay. This can't be undone.`
  - buttons `Discard` / `Cancel`; Cancel is the escape answer.
- **Conflicts:** while the repo has conflicted files, discard is disabled, like Stage all.
- A file open in the editor follows the existing rule: with no unsaved edits it quietly takes the
  disk version.

## How it is built

- New `GitOp`s `{ op: 'discard'; file: FileChange }` and `{ op: 'discardAll' }` through `git:run`:
  busy label `Discarding…`, one write per repo, the error in the repo's red box. The main process
  checks again just before running, from a fresh status: the path is still in CHANGES, nothing is
  conflicted, and untracked paths stay inside the repo.
- Trashing goes through an injected `trash` dependency (as `FileOps` does), so tests don't touch the
  real Trash.
- The confirmation comes from `questions.ts`, asked from the main process before running.

## Approaches

- **Chosen:** new ops through `git:run`, untracked files to the Trash, asked first.
- Saving to a stash first: refused by the user (not how their other editors work).
- Deleting untracked files with `git clean` / `rm`: direct, but nothing to recover from a misclick.

## Non-goals

- Discarding staged changes, or hunks and lines.
- Undoing a discard inside edi.

## Left to the builder

- An untracked folder that git lists as one entry: trash it whole.
- Exact icon (lucide `Undo2` is already used for Undo commit; pick a distinct one such as `RotateCcw`).
