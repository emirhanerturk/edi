# Revert a commit

2026-11-26, requested by the user. A small change.

## Why

Now and then the user needs to take back a commit they already made, often one that is already
pushed. Undo commit (`git reset --soft HEAD~1`) only covers the newest unpushed one. Revert
commits the inverse instead and leaves history alone, so it is safe on pushed commits too. This
lifts the "reverting pushed commits" non-goal in `2026-11-24-edi-editor-files-git-design.md`.

## Goals

- **Commit view:** a ⋯ button in the header, next to copy and Open on GitHub, opens a native menu
  with **Revert commit** (user).
- **History:** right-clicking a row (Timeline and By repo) opens a native menu with **Copy SHA**,
  **Open on GitHub** and **Revert commit** (user). Open on GitHub is left out when the repo has no
  GitHub remote.
- Revert asks first with a native dialog (my call): `Revert the commit "<subject>"?`, detail "A new
  commit is made that undoes its changes. The original commit stays in the history.", buttons
  **Revert commit** / Cancel.
- On yes, `git revert --no-edit <oid>`: one new commit with git's own message `Revert "…"`. No step
  to edit the message (my call: it is rarely used, and the message can still be amended in a terminal).
- **Conflicts: abort automatically** (user). If the revert stops for any reason and leaves
  `REVERT_HEAD`, edi runs `git revert --abort` straight away and reports "This commit can't be
  reverted cleanly: it conflicts with later changes". The repo is never left half reverted.

## Rules, checked again in the main process just before running

- `oid` is a full commit hash and is an ancestor of HEAD (on the current branch).
- It is not a merge commit. For merge commits the menu item is disabled (my call: choosing a
  parent is too much for something this rare).
- No merge, rebase, cherry-pick or revert is in progress, and there are no conflicts.
- Local changes are left to git: if they would be overwritten, git refuses and its error is shown.

## How it is built

- A new `GitOp` `{ op: 'revertCommit'; oid }` through `git:run`, like `undoCommit`: busy label
  "Reverting…", one write operation per repo, the error in the repo's red box.
- The menus are native popups from the main process, like the stash row's menu. The confirmation
  comes from `questions.ts`, like `undoCommitQuestion`.
- If the revert fails while started from the commit view or History, the left panel switches to
  the Git tab and expands that repo, so the error is visible (my call). On success nothing extra
  is shown: the new commit appears at the top of History and under Unpushed.

## Approaches

- **Chosen:** a new op through the existing `git:run` path with native menus. It gets the busy,
  one-at-a-time and error rules for free and matches the stash menu.
- A React dropdown for ⋯: could be styled, but every other menu in edi is native.
- Running revert outside `git:run`: it would lose the busy and error rules and the last-moment checks.

## Non-goals

- Reverting merge commits, or several commits at once.
- Resolving revert conflicts in edi (Continue/Abort buttons).
- Editing the revert message, or "Stash and revert" when local changes are in the way.

## Left to the builder

- Where the GitHub URL for a History row comes from (`remoteUrl.ts` already builds the commit view's).
- Exact wording of the success message (for example "Reverted; the new commit isn't pushed yet").
- Tests: unit tests for the checks and the automatic abort against a real temporary repo, as in
  `tests/unpushed.test.ts`, plus an e2e test of the menu path.
