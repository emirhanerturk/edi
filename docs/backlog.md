# Pending small issues

Findings deferred from the final reviews of plans 1–4 and the server list, ranked by their
impact on the user. An item is removed from here once it is fixed. Last updated: 2026-11-25.

## Low priority: edge cases and looks

1. **Server list:** the menu reopens by itself when servers come and go; a closed tab's row
    stays for 3 s; a short race on folder switch; truncated `lsof` output can show a wrong port
    for one poll; no warning if opening in the browser (or Option-click in the terminal)
    fails. (servers)
2. **Files tab inside an ignored folder:** a file or folder made inside an open ignored folder
    (such as `dist/`) shows only after that folder is closed and opened again; its one-level
    listing is not read again after the change. The new file still opens in the editor.
    Renames and the existence check have a small TOCTOU window between the check and
    `rename` (no exclusive rename on macOS from Node). (editor, Files and Git round)
3. **Looks and small behaviors:** the repo header's "merging" chip also shows when a stash
    applied with conflicts (it isn't a merge); a long branch name squeezes the repo name in an open repo's
    header; the branch menu closes when the page
    scrolls; the selected row does not tell the file view from the diff view. (plan 1, 2)
4. **Install details:** ~60 MB of node-pty Windows files and sources in the bundle;
    `isRunning`'s `pgrep -f` pattern is not anchored (false positives); no warning when
    `~/.local/bin` is not on PATH; `edi -` and a folder without permission say "not a folder".
    (plan 4)
5. **Theoretical risks:** a TOCTOU between `realpath` and `open` when reading files, and
    unbounded reads of a growing file; releasing the busy lock depends on the refresh not
    throwing; `process.env` is modified after startup; in a SHA-256 repo with no commits the
    diff base is wrong. (plan 1, 2, 4)
