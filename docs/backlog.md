# Pending small issues

Findings deferred from the final reviews of plans 1–4 and the server list, ranked by their
impact on the user. An item is removed from here once it is fixed. Last updated: 2026-11-24.

## High priority: lost work or wrong information

1. **Claude tabs may go unrecognized.** `pgrep -x claude` misses a versioned install: the
   process shows as `claude` in `ps`, but its kernel name is the version number
   (`2.1.331`). A tab running such a Claude gets no icon and no "waiting for input" bell,
   and the session count comes up short. (found later; `src/sessions.ts` `listClaudePids`)
2. **A commit message typed while a hook runs can be lost.** The box is cleared when the
   commit finishes, which also drops text added while the hook was running. (plan 1)
3. **Quitting and switching folders do not ask while a push or commit runs.** The running git
   operation can be cut off halfway. (plan 1)
4. **The reason for a rejected push is not shown.** The error line picker hides the server's
   explanation; when a hook rejects, only the last line of the hook output shows. (plan 1)
5. **Logging out of or restarting macOS may be cancelled.** edi defers quitting every time;
   this may block logout. Not verified. (plan 1)

## Medium priority: annoying in daily use

6. **One slow repo holds up all of them.** The screen refreshes only once the status of every
   repo has arrived (`refreshAll`). (plan 1)
7. **Races while switching folders.** A terminal opened at that moment can silently stay dead;
   a double click on a recent folder opens it twice; two hand-overs in a row through `edi` can
   race in `Workspace.open` (no generation check); a hand-over that arrives before the app is
   ready is lost. (plan 1, plan 4)
8. **Opening a recent folder that no longer exists** fails silently while another folder is
   open. (plan 1)
9. **Installing is not atomic.** `npm run dist` deletes the old app and copies the new one; if
   the copy stops halfway the app is gone, and the half-copied bundle stops later installs as
   "not edi". (plan 4)
10. **The Files tree is rebuilt on every poll** (`buildTree`, no memo). (plan 2)
11. **A nested repo or a submodule** shows in Files as a nameless row or one that cannot be
    opened. (plan 2)
12. **Tests run the real `~/.profile`** (pty and e2e shells);
    `tests/sessions.test.ts:70-76` can never fail. (plan 1)
13. **There is no way back from a detached HEAD to a branch in the interface.** (plan 1)

## Low priority: edge cases and looks

14. **Keyboard access:** center panel tabs; opening rows with Space and pinning them from the
    keyboard (Files, History); arrow keys in the tree; arrow keys in menus. (plan 2, 3, servers)
15. **History:** a new tag or a push without `-u` shows only after a refresh (`historyKey`
    counts neither tags nor remote refs); "Load 50 more" also shows in By repo, stops at the
    5000 limit, and can append twice while loading; a non-UTF-8
    `i18n.logOutputEncoding` garbles Turkish characters (`--encoding=UTF-8`). (plan 3)
16. **Commit view:** the leading indentation of body paragraphs is stripped; syntax coloring
    stops at the first file over the budget (it should skip it and go on); the README does not
    mention the 3,000-line budget for open files. (plan 3)
17. **Server list:** the menu reopens by itself when servers come and go; a closed tab's row
    stays for 3 s; a short race on folder switch; truncated `lsof` output can show a wrong port
    for one poll; no warning if opening in the browser (or Option-click in the terminal)
    fails. (servers)
18. **Looks and small behaviors:** a long branch name squeezes the repo name in an open repo's
    header; Zed can open twice on a cold start (5 s+); the branch menu closes when the page
    scrolls; the selected row does not tell the file view from the diff view. (plan 1, 2)
19. **Install details:** ~60 MB of node-pty Windows files and sources in the bundle;
    `isRunning`'s `pgrep -f` pattern is not anchored (false positives); no warning when
    `~/.local/bin` is not on PATH; `edi -` and a folder without permission say "not a folder".
    (plan 4)
20. **Theoretical risks:** a TOCTOU between `realpath` and `open` when reading files, and
    unbounded reads of a growing file; releasing the busy lock depends on the refresh not
    throwing; `process.env` is modified after startup; in a SHA-256 repo with no commits the
    diff base is wrong. (plan 1, 2, 4)
