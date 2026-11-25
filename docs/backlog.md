# Pending small issues

Findings deferred from the final reviews of plans 1–4 and the server list, ranked by their
impact on the user. An item is removed from here once it is fixed. Last updated: 2026-11-25.

## High priority: lost work or wrong information

## Medium priority: annoying in daily use

1. **A nested repo or a submodule** shows in Files as a nameless row or one that cannot be
    opened. (plan 2)
2. **Tests run the real `~/.profile`** (pty and e2e shells);
    `tests/sessions.test.ts:70-76` can never fail. (plan 1)
3. **There is no way back from a detached HEAD to a branch in the interface.** (plan 1)

## Low priority: edge cases and looks

4. **Keyboard access:** center panel tabs; opening rows with Space and pinning them from the
    keyboard (Files, History); arrow keys in the tree; arrow keys in menus. (plan 2, 3, servers)
5. **History:** a new tag or a push without `-u` shows only after a refresh (`historyKey`
    counts neither tags nor remote refs); "Load 50 more" also shows in By repo, stops at the
    5000 limit, and can append twice while loading; a non-UTF-8
    `i18n.logOutputEncoding` garbles Turkish characters (`--encoding=UTF-8`). (plan 3)
6. **Commit view:** the leading indentation of body paragraphs is stripped; syntax coloring
    stops at the first file over the budget (it should skip it and go on); the README does not
    mention the 3,000-line budget for open files. (plan 3)
7. **Server list:** the menu reopens by itself when servers come and go; a closed tab's row
    stays for 3 s; a short race on folder switch; truncated `lsof` output can show a wrong port
    for one poll; no warning if opening in the browser (or Option-click in the terminal)
    fails. (servers)
8. **Files tab inside an ignored folder:** a file or folder made inside an open ignored folder
    (such as `dist/`) shows only after that folder is closed and opened again; its one-level
    listing is not read again after the change. The new file still opens in the editor.
    Renames and the existence check have a small TOCTOU window between the check and
    `rename` (no exclusive rename on macOS from Node). (editor, Files and Git round)
9. **Looks and small behaviors:** the repo header's "merging" chip also shows when a stash
    applied with conflicts (it isn't a merge); a long branch name squeezes the repo name in an open repo's
    header; Zed can open twice on a cold start (5 s+); the branch menu closes when the page
    scrolls; the selected row does not tell the file view from the diff view. (plan 1, 2)
10. **Install details:** ~60 MB of node-pty Windows files and sources in the bundle;
    `isRunning`'s `pgrep -f` pattern is not anchored (false positives); no warning when
    `~/.local/bin` is not on PATH; `edi -` and a folder without permission say "not a folder".
    (plan 4)
11. **Theoretical risks:** a TOCTOU between `realpath` and `open` when reading files, and
    unbounded reads of a growing file; releasing the busy lock depends on the refresh not
    throwing; `process.env` is modified after startup; in a SHA-256 repo with no commits the
    diff base is wrong. (plan 1, 2, 4)
