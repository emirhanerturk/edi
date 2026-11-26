# edi — desktop app: design

Date: 2026-11-24

This document replaces the **interface** part of
`2026-11-24-edi-multi-repo-git-tui-design.md`. The git behavior and anti-goals in that
document still hold; here they are rewritten as adapted to the app. Where the two
conflict, this document wins.

Source of the visual design: `docs/design/edi-ui/` (the canvas files) and the live
version of the same canvas at <https://claude.ai/artifact/H9e4gijgVcFaK4s9mKkKbH>.
Those files are authoritative for sizes, colors and copy; this document describes
behavior.

## Goal and rationale

The user works with around eight repos at once and does most of their work in the
terminal, with Claude Code. They like Zed's layout (terminals on the left, file/diff
in the center, files and git on the right), but Zed's git panel shows one repo at a
time. What they want is not an IDE; in their own words, a "git-backed terminal
management tool": terminals and Claude Code sessions on the left, the status and
history of **all repos** on the right, and the file or diff they want to look at in
the center.

We first planned this as a TUI living in a Zed terminal tab. The git core was written
for that plan (`src/git/*`, 100 tests). Then we did a one-day Electron spike
(`spike/electron-terminal`); the user confirmed that it worked without problems with
their own zsh profile, a Turkish keyboard, Shift+Enter and pasting, and decided to
write our own app.

## Goals

- See the branch, ahead/behind and change status of every git repo in a folder in a
  single live list; stage, commit, push, pull, fetch and switch branches from that
  list.
- Multiple terminal tabs in the same window; recognize the tab running Claude Code by
  its icon and tell apart the one waiting for a reply.
- See the latest commits of all repos in a single timeline; click a commit to look at
  its contents.
- Look at a change, look at or make a small edit to a file, and open it in Zed with one click.

## Non-goals (first version)

- Language services in the editor (completion, errors, go to definition): Zed is for that.
- Search (file name or content).
- Saving terminal sessions when the app closes and restoring them.
- AI-generated commit messages.
- Merge, rebase, conflict resolution, cherry-pick, commit graph. (Stash was here too; it was
  added on 2026-11-25, requested by the user: `2026-11-25-edi-stash-design.md`.)
- Line/hunk-level staging. Discard (reverting a change).
- Settings screen and settings file; accent color, font and shortcuts are fixed.
  (The gear button in the design is not in the first version.)
- Multiple windows, multiple working folders.
- Signing, notarization, auto-update, distribution to others.
- Remote-only branches; history of branches other than HEAD.
- Image preview. Binary files are shown with a "binary file" note.

## Anti-goals

- Nothing goes to the remote that the user didn't ask for, and no change is deleted.
  The following git commands are never run by any path in the code: `reset --hard`,
  `checkout -- <path>`, `restore` (on the working tree), `clean`, force push,
  `rebase`, `--no-verify`, `fetch --prune`.
- No automatic fetch/pull/push; all of them happen on the user's click.
- The app never types commands into terminals on its own. The only exception: the
  "new Claude session" button types `claude` into the tab it has just opened.
- An error in one repo doesn't break the other repos.
- No network requests: fonts are embedded in the app, no telemetry.
- edi doesn't mark a conflict as resolved.

## Constraints

- macOS (Apple silicon), Node 24, git 2.50. Go/Rust are not installed.
- npm 12 blocks install scripts: node-pty's prebuilt binary is used and
  `spawn-helper` is made executable; the Electron binary is downloaded separately.
- The Zed CLI may not be on PATH; `/Applications/Zed.app/Contents/MacOS/cli` exists.
- The user's commit convention is Conventional Commits; edi doesn't validate or
  change the message.
- The interface language is English.

## Approaches

1. **TUI in a Zed terminal tab** — the cheapest; its core is already written. But file
   and diff views are weak in a terminal, it can't mark the Claude tab, and it can't
   live in Zed's right panel (Zed extensions can't add panels).
2. **Our own desktop app, Electron (chosen)** — all three panels are ours. The cost:
   terminal quality and packaging are our responsibility. The terminal risk was
   closed by the spike.
3. **Tauri** — lighter, but Rust isn't installed and the pty side would have to be
   tried from scratch. Rejected.
4. **A Zed fork** — the panel would be exactly where it belongs; Rust/GPUI and
   maintaining a fork are too expensive for a one-person tool. Rejected.

The user picked 2 after the spike.

## Window

A single window. A title bar on top, a status bar at the bottom, and three panels in
between: left (terminals), center (file/diff/commit), right (Git, History, Files).

- **Title bar:** macOS traffic lights, "edi", the folder button in the middle
  (`~/studios/quizei`), and on the right the number of open Claude Code sessions under
  this folder ("2 sessions"; hidden when there are none).
- **Folder button:** opens a menu with recent folders and "Choose folder…".
  Switching folders closes the open terminals; if a process is running, it asks first.
- **Startup:** if the last opened folder still exists, the app opens with it;
  otherwise an empty-state screen ("Open a folder", a list of recent folders).
- **Panels:** resized by dragging the line between them; widths are remembered. When
  the center panel is closed, the left panel takes the freed space.
- **Status bar:** on the left "8 repositories", the number of repos with changes and
  the number of repos waiting to push; on the right, brief info depending on what is
  open in the center panel.
- **Quit:** if a terminal has a running process, it asks before quitting.

Repo discovery is as in the TUI document: folders one level below the opened folder
that contain `.git`, by name; if the folder itself is a repo, only that one. If there
are no repos, the terminals still work and the right panel says "No git repositories
in this folder".

### Which Claude Code sessions count

The count in the title bar and the Claude mark on a repo row show the Claude Code
sessions on this machine that run **in a terminal** (have a tty) and whose working
directory is inside the open folder; both those in edi's own tabs and those in
another terminal app count. Sessions without a terminal (e.g. the ones Zed's agent
panel runs in the background) don't count. If the working directory is inside a
repo, the mark appears on that repo's row. (My call: knowing about a Claude working in
the same repo somewhere else is useful; counting invisible background processes makes
the number meaningless.) `src/sessions.ts` gains a tty filter accordingly.

## Left panel: terminals

- Each tab is a real pty running the user's login shell (login + interactive); its
  working directory is the open folder. The terminal button on a repo row opens the
  tab in that repo's directory.
- The `CLAUDECODE`, `CLAUDE_CODE_*` and `ELECTRON_*` variables are removed from the
  environment passed to the shell.
- Keyboard: the Option key is not treated as Meta (so `@ # [ ]` can be typed on a
  Turkish keyboard), Shift+Enter sends a newline (`ESC CR`), Cmd+C/Cmd+V copy/paste.
- **Tab bar:** the tabs, and on the right `+` (new terminal) and a button with the
  Claude icon (new Claude session). A tab's name is its foreground process's command
  (`npm run dev`); when idle, it is the shell's name (`zsh`). Names don't wrap to a
  second line; when space runs short they are truncated with an ellipsis. Each tab
  reserves space for its close cross: on the active tab it is visible, on the others
  it appears and becomes clickable on hover (2026-11-24, requested by the user).
- **Claude tab:** while Claude Code is in the foreground on a tab's tty, the tab's
  name becomes `claude` and its icon the orange Claude mark (`#D97757`); when Claude
  exits, the tab returns to normal. It is recognized the same way whether the user
  opens Claude with the button or by typing `claude` in a plain tab. Detection goes by
  tty, not by process name (node-pty reports the process name as a version number).
- **Claude waiting for a reply:** see the "Waiting-for-reply mark" section below.
- **When the process ends:** the tab doesn't close; a faint "exited" appears next to
  its name and the user closes it. (My call: so the output stays readable.)
- **Shortcuts:** Cmd+T new terminal, Cmd+Shift+T new Claude session, Cmd+W close the
  active tab (asks if a process is running), Cmd+1…9 switch to a tab, Cmd+O open a
  folder. Cmd+W and Cmd+R don't close/reload the window.

### Waiting-for-reply mark

While Claude Code is waiting for a reply (asking for permission or having handed the
turn back to the user), a yellow bell icon appears on its tab; it disappears when the
user switches to that tab or Claude starts working again.

Mechanism (my call; half verified):

- Claude Code reports its own state to the terminal it runs in. Tried with 2.1.331:
  while idle it sets the terminal title to `✳ Claude Code` (OSC 0), and at startup it
  asks the terminal whether it supports the "OSC 7501 Program Status" protocol
  (`OSC 7501 ; ?`). This information comes from the tab's own pty stream: no settings
  change, hook or process matching is needed, and it works however the user opens
  Claude.
- **First choice:** read the state mark in the tab's title. What the title is while
  working and while asking for permission hasn't been observed yet; the first job of
  this part is to record that in a real session and write the rule based on the
  observation.
- **Fallback:** `claude agents --json` (the path Claude Code documents for reading
  session state from outside; it gives `status: busy | waiting | idle` and `pid`),
  with pid → tty matching.
- The user's `~/.claude/settings.json` file is not touched, no hook is injected, the
  `claude` command is not wrapped, and `TERM_PROGRAM` is not made to look like another
  terminal.
- If neither proves reliable, the bell is dropped from the first version and the user
  is told: a bell that rings wrongly is worse than no bell at all.

## Center panel

Closed by default. It opens when a file, change or commit is clicked in the right
panel. The cross at the right end of the tab bar closes the panel; the tabs stay in
place, and when something is clicked the panel comes back with the same tabs. Closing
the last tab closes the panel too.

- **Tabs:** a single click opens a preview tab (the next single click replaces the
  same tab); a double click makes the tab permanent. Clicking something already open
  switches to that tab. (My call: so tabs don't pile up while browsing through diffs.)
- **Diff view** (from the Git tab): the file's entire change against HEAD (staged +
  unstaged together). At the top: the repo and path, `+7 −3`, a "Split / Inline"
  choice (remembered), "Open file" (the whole file; the diff tab becomes permanent and
  stays in place, the file opens in the preview tab; absent for a file deleted from
  the working tree) and "Open in Zed". A new (untracked) file opens in the file view
  with a "new file" badge instead of a diff. Also works in a repo with no commits yet.
- **File view** (from the Files tab): a text file opens in an editor (Monaco, with
  Shiki's One Dark Pro colors, the same as the diff view); ⌘S saves. Unsaved edits, disk
  changes under them and saving are described in
  `2026-11-24-edi-edit-files-design.md` (added 2026-11-24, requested by the user). At the
  top: the path and "Open in Zed"; "Unsaved" and Save while there are unsaved edits;
  "Read-only" for files that can't be edited. The editor shows a minimap, bars in the gutter
  for lines changed since HEAD, and a muted note at the end of the cursor's line saying who
  changed it last, when and why; clicking the note opens that commit. A new untitled file
  opens with ⌘N, the + in the tab bar or a double click on its empty part, and is saved
  through the Save panel. Both are described in `2026-11-24-edi-editor-files-git-design.md`
  (2026-11-24, requested by the user). Images
  (png, jpg, gif, webp, avif, bmp, ico, svg) and videos (mp4, m4v, webm, ogv, mov) are
  previewed, with no size limit: the main process serves them from an `edi-media://`
  address, only from inside the discovered repos (with links resolved), and with byte
  ranges so videos can be seeked; the page's CSP allows this address only as
  `img-src`/`media-src`, and `connect-src` stays closed. Other files larger than 1 MB,
  or binary files, are not shown; a short note and "Open in Zed" appear instead.
- **Commit view** (from the History tab): the subject (Conventional Commits prefix
  faint), the body text, the author (name; email on hover), repo, branch, relative
  time, total `+/−`, short hash and a copy button; below that, the changed files one
  under another, each with its inline diff. A file header expands and collapses its
  diff; a diff over 400 lines starts collapsed; the single button in the info line
  collapses them all (if any is expanded) or expands them all. If the commit has been
  pushed (some remote branch contains it) and that remote repo is on GitHub, a
  "GitHub" button opens the commit page in the browser; no network access is made,
  and credentials in the URL are stripped (2026-11-24, requested by the user).
- **Open in Zed:** in order, `zed` on PATH, `/Applications/Zed.app/Contents/MacOS/cli`,
  `open -a Zed`. If all of them fail, an error is shown.
- If the file changes on disk, the open view refreshes on that repo's next status
  poll.

## Right panel

Three tabs: **Git** (with a badge for the number of changed files), **History**,
**Files**.

### Git

All repos one under another. Repos with changes start expanded, clean ones collapsed;
if the user expanded or collapsed one by hand, that preference holds for the session.

**Collapsed repo row** (left to right): the name (truncated when space runs short);
the Claude mark if a Claude Code session is inside it; a gap; the branch; the status
(`✓` or the number of changes); and, when needed, a single sync button at the far
right. The count is written on the button; no separate text like `↑1` is shown. All
rows in the design files are in this form.

| State | Button | What it does |
|---|---|---|
| Behind (`↓n`) | "Pull n" | `git pull --ff-only` |
| Only ahead (`↑n`) | "Push n" | `git push` |
| No upstream, has commits | "Publish branch" | `git push -u origin <branch>` |
| Even | none | |

If it is both ahead and behind, "Pull n" is shown; if a fast-forward isn't possible,
git's error is shown and edi doesn't force it. If a branch without an upstream has no
commits, no button is shown. Button styles: "Push" filled (accent color), "Pull"
outlined with yellow text, "Publish branch" with a neutral outline.

**Expanded repo:** the header has the name, the branch button, pull, push and "open a
terminal in this repo"; below it, the commit box and the file groups.

- **File groups:** "Staged" and "Changes" (each header collapses its group, with a chevron
  on the left); each file has a status letter (M, A, D,
  R, `?`; a deleted file's name is struck through), the name, the folder and a button
  that stages/unstages that single file; the group header has a button that
  stages/unstages them all. A partly staged file appears in both groups and carries a
  "partly staged" label. New files are listed one by one, not as folders.
- **Conflicts:** a separate "Conflicts" group (`U`), with "Open in Zed" on each file.
  A conflicted file can't be staged from edi; while there are conflicts, "stage all"
  and "Commit all" are refused. A "merging" label appears in the repo header.
- **Commit box:** a multi-line text area (the first line is the subject, the rest the
  body). Cmd+Enter commits. While the message is empty, the button is disabled.
  - If there are staged files, the button reads "Commit · N files"; only the staged
    ones are committed.
  - If nothing is staged, the button becomes "Commit all · N files" and below it
    reads "Nothing is staged. This commits every change, new files included.";
    pressing it does `git add -A` + commit. No extra confirmation is asked. (My call:
    the button's name and note stand in for a confirmation.)
  - The arrow next to the button opens a one-item menu: "Commit and push".
  - Hooks run normally; if a hook rejects, its error is shown.
- **Unpushed:** in an expanded repo ahead of its upstream, its commits not pushed yet;
  clicking one opens the commit view. The newest has "Undo commit" (`git reset --soft
  HEAD~1`, after asking; its changes come back staged), offered only for a non-merge commit
  that isn't on the upstream, checked again just before running (2026-11-24, requested by
  the user; see `2026-11-24-edi-editor-files-git-design.md`).
- **Branch menu:** local branches, with the current one checked; choosing one runs
  `git switch`. "New branch…" asks for a name and runs `git switch -c`. If git refuses
  (uncommitted changes), the error is shown, with "Stash and switch"; nothing is forced.
- **Stashes:** a Stash button next to Commit, a "Stashes" section under the repo, a count on
  the collapsed row, and a stash view in the center panel (2026-11-25, requested by the user;
  see `2026-11-25-edi-stash-design.md`).
- **Busy and error:** while an operation runs, a spinner and text like "Pushing…" on
  the repo row. Only one write operation runs at a time in the same repo; if a second
  one is requested, "Another operation is still running" is shown. An error is shown
  in a red box under the repo with git's most informative line; for a rejected push
  the box has a "Pull" button; "Dismiss" closes the box.
- **Buttons in the tab header:** fetch in all repos; rescan the repos.
- A git command that asks for credentials doesn't lock the interface
  (`GIT_TERMINAL_PROMPT=0`); it fails and its error is shown. Credential helpers and
  the SSH agent work normally.

### History

The commits on the current branches (HEAD) of all repos in a single list, newest to
oldest, under day headings ("Today", "Yesterday", "This week", older ones by date).
The last 50 commits per repo are read; "Load 50 more" at the end of the list fetches
50 more from each repo.

The merged list doesn't show gaps: among the repos that still have older commits, the
newest of their oldest loaded commits is the cutoff, and the list shows nothing older
than that cutoff (otherwise an active repo's older days would look as if "there were
no commits that day"). "Load 50 more" pushes the cutoff back. Repos whose commits are
all loaded don't set the cutoff. (My call.)

- **Row:** the subject (Conventional Commits prefix faint), below it the repo name and
  the relative time, and on the right the short hash. The author is shown by name if
  different from that repo's `user.email` value; it isn't shown on the user's own
  commits.
- **Unpushed commit:** an up arrow on the row of a commit that isn't in the upstream.
- **Release row:** if a tagged commit's subject is the tag itself (`1.86.0`
  ↔ `v1.86.0`), it is shown as a thin tag row; otherwise a tag badge appears on the
  normal row.
- **Merge commits** are shown faint.
- **Filtering:** a single repo is picked from the "All repositories" menu. With a
  single repo, rows don't show the repo name, and an `origin/main` line goes between
  the pushed and unpushed commits.
- **Layout choice:** "Timeline" (the one above) and "By repo": under each repo heading
  its last three commits, one line each; repos with no recent commits are collapsed
  and show their last commit time. The choice is remembered.
- Clicking a commit opens the commit view in the center panel.
- **Right-click menu** on a commit: Copy SHA, Open on GitHub (when it has a page) and Revert
  Commit…. The commit view's header has the same Revert behind a ⋯ button. Revert asks first,
  runs `git revert --no-edit`, and aborts again at once if it stops on conflicts; merge commits
  can't be reverted (2026-11-26, requested by the user; see
  `2026-11-26-edi-revert-commit-design.md`).
- The list updates when a commit, pull or fetch is made in that repo, when HEAD
  changes, and with the refresh button.

### Files

The repos in the open folder at the top level, as separate sections like in the Git
tab (same row height; an expanded repo highlighted); under each one, its working
tree. Files and folders matched by `.gitignore` are shown faint (2026-11-24, requested
by the user). An ignored folder's contents don't come from git; when the folder is
expanded, only that level is read from disk (at most 2,000 entries, the rest shown as
"N more not shown"), and it is forgotten when collapsed. Its contents are also faint
and expandable (e.g. `node_modules`, `ios`, `dist`). Changed files are marked with
their status letter and color, and folders containing changes with a dot. Clicking a
file opens the file view. The button in the tab header collapses all folders. If the
open folder itself is a single repo, the tree starts directly with that repo's
contents. Files carry monochrome, muted icons by type. New files and folders, rename,
Move to Trash and Reveal in Finder come from a right-click menu and from buttons on
repo and folder rows; names are typed inline (2026-11-24, requested by the user; see
`2026-11-24-edi-editor-files-git-design.md`).

## Refreshing

- Each repo is polled with `git status` about every 2 seconds
  (`--no-optional-locks`); for a given repo, a new poll doesn't start before the
  previous one finishes. After every operation, the affected repo is refreshed
  immediately.
- Claude Code sessions and the tabs' foreground processes are polled about every 3
  seconds. If detection fails, the mark isn't shown, and no error is shown either.
- No file system watching.

## Visual language

A dark theme based on One Dark; no light theme.

- **Surfaces:** terminal/center panel `#282C34`, panels and bars `#21252B`, expanded
  repo `#252930`, input fields `#1B1D23`, selected row `#2F343E`, lines `#181A1F`.
- **Text:** primary `#D7DAE0`, secondary `#ABB2BF`, faint `#969DA8`.
- **Accent:** neutral light gray `#D7DAE0` (primary button, active tab underline,
  selected row marker, push counter); the text on it is `#1B1D23`.
- **Signal colors:** yellow `#E5C07B` (modified, to be pulled, bell), green
  `#98C379` (new, added line, clean), red `#E06C75` (deleted, removed line, error,
  conflict), cyan `#56B6C2` (renamed, hunk header), Claude orange `#D97757` (only for
  Claude Code).
- **Type:** interface in IBM Plex Sans 13 px; paths, branches, hashes, commit
  messages and code in IBM Plex Mono 12 px. Both are embedded in the app. The terminal
  uses the font stack from the spike (`SF Mono`, Menlo, Monaco).
- Icons are line SVGs; no emoji.

## Technical decisions (my calls)

- **Electron + React + TypeScript.** Terminal: `@xterm/xterm` (WebGL rendering) and
  `node-pty`; both were verified in the spike.
- **Process separation:** git, pty and file reading in the main process; the
  interface in a window with `contextIsolation` on and `nodeIntegration` off. The
  interface reaches the main process through a narrow, typed bridge: it sends a repo
  path and an operation name, never a free-form command; the main process verifies
  that the path is one of the discovered repos.
- **Git** only through the `git` CLI, via the existing `src/git/*`; git output is
  pinned to English (`LC_ALL=C`) so that picking the error line doesn't depend on the
  locale.
- **Diff and file view** are our own components: the unified diff is parsed in the
  core, highlighting is done with Shiki (One Dark Pro theme). Monaco is not used.
  (Why: read-only, many diffs stacked in the commit view, and a one-to-one match with
  the design.)
- **Persistent state** (last folder, recent folders, panel widths, diff and history
  layout, window position) in a single JSON file in Electron's user data folder.
- **Packaging:** `npm run dev` during development; `npm run dist` produces an
  unsigned `edi.app` that can be put in the Dock.
- **Tests:** the git core with real repos in temporary directories (as today;
  including the new log, commit contents and file list functions); the diff parser
  and history merging with unit tests; interface components with component tests; the
  main flows (open a folder, see the repos, stage, commit, run a command in the
  terminal, open a diff) with Playwright's Electron support, in a temporary working
  folder. No test touches the real repos under `~/studios`.

## What stays and what goes from the existing code

- **Stays:** `src/git/exec.ts`, `discover.ts`, `status.ts`, `actions.ts`,
  `src/sessions.ts` and their tests.
- **Changes:** the Turkish strings in the core (error messages, labels) become
  English. HEAD's commit id is added to `RepoStatus`.
- **Added:** commit history, a single commit's contents, the tracked/untracked file
  list, file reading, process detection by tty.
- **Goes:** the Ink TUI dependencies (`ink`, `ink-testing-library`), the `bin`
  entry, the TUI-specific parts of `src/ui/rows.ts`, `diffRepo`,
  and, once the app's terminal works, `spike/electron-terminal`.
- **Small findings left over from review, to be closed along with this work:** a
  branch with the same name as a tag showing up as `heads/…`; ref names starting with
  `-`, and pushing with `refs/heads/<branch>`; pushing on a branch whose upstream was
  deleted; a deleted repo folder showing `spawn git ENOENT`; a wrong timeout on a hook
  that sends a process to the background; `origPath` on copy entries.
- **Left open:** the diff base in a SHA-256 repo with no commits.

## Left to the implementer

- File/module structure, state management, component split, build tooling.
- The exact shape of the bridge (IPC).
- The exact poll interval values, slowing down while the window is in the background.
- Minimum panel widths, virtualization of long lists.
- Pairing removed and added lines in the side-by-side diff.
- The relative time format and the boundaries of the day groups.

## Later additions

Things the user asked for after the design was approved, not yet planned.

- **`edi <path>` command (2026-11-24):** typing `edi <path>` in any terminal opens
  that folder in edi; `edi .` opens the current folder. It belongs to the packaging
  plan (plan 4): the command is a small script that launches the installed app (put
  on PATH), and the app opens the folder given to it at launch. If the app is already
  open, the same window switches to that folder; if a terminal is running, the
  question asked when switching folders is asked here too. With no path, the app opens
  with the last folder.
  **Installation (chosen by the user, 2026-11-24):** `npm run dist` builds the app,
  copies it to `/Applications/edi.app` and installs the `~/.local/bin/edi` link
  (`~/.local/bin` is on the user's PATH; no admin password needed). Running it again
  updates them. Installation doesn't happen while edi is open ("quit edi first"); if
  an `edi.app` or `~/.local/bin/edi` that doesn't belong to edi is there, it isn't
  overwritten.
- **Login shell environment (plan 4):** an app launched from the Dock doesn't get the
  user's shell settings (PATH: node from nvm, Homebrew); git hooks (e.g. husky) fail
  with "node not found". When the packaged app starts, the login shell's environment
  is read once (`$SHELL -ilc`, with a timeout) and added to the main process's
  environment; if it can't be read, the app carries on with the environment it has.
- **App icon (2026-11-24):** the user picked the "Wordmark" option
  (`docs/design/icon/wordmark.svg`). In plan 4, the `.icns` is generated from it.

- **Running servers (2026-11-24, approved by the user):** development servers that
  come up in edi's terminals (e.g. `localhost:5173` via `npm run dev`) are listed, and
  clicking an address opens it in the default browser. Goal: reach the server without
  going back to the terminal to look for the address.
  - **Finding them (the path the user chose):** from the process tree, not from the
    terminal output. In the 3-second process poll, the TCP ports opened for listening
    by non-shell processes running on the ttys of edi's terminals are read with
    `lsof -nP -a -iTCP -sTCP:LISTEN -p <pids>`. That way a server is visible even after
    the output has scrolled away, and when it shuts down it disappears within one poll
    at most. If no tab has a process other than the shell, `lsof` isn't run.
  - Only listeners reachable from `localhost` count: `*`, `0.0.0.0`, `[::]`,
    `127.x.x.x`, `[::1]`. A listener on only a specific network address isn't taken.
    If the same port listens on both IPv4 and IPv6, it counts once. Ports in the range
    the operating system hands out at random to callers of `listen(0)` (49152 and
    above on macOS) don't count: these are internal ports nobody configured (vite
    plugins, workerd). The Claude Code process itself doesn't count either (it opens
    its own internal port); servers it starts do count.
  - The server's repo is found from the listening process's working directory
    (`lsof -d cwd`); if it isn't in any repo, no repo name is shown.
  - The list is sent to the page only when it changes.
  - **Display (my suggestion, approved by the user):** a `● N servers` counter on the
    right of the status bar; hidden when there are no servers. Clicking it opens a
    menu: each row has `localhost:PORT`, the repo name and the tab's title (e.g.
    `npm run dev`). Clicking a row opens `http://localhost:PORT/` in the default
    browser. On the terminal tab where the server runs, the port appears as a small
    label (with several ports, the first one and `+N`).
  - **Out of scope:** edi doesn't send requests to the servers (no polling, no health
    checks), doesn't stop or restart servers, and doesn't read terminal output.
    Servers started outside edi (Docker, another terminal app) aren't visible.
  - **Trade-off:** `https` can't be told from the port; the address always opens with
    `http://`. A dev server using HTTPS is reached with Option+click on the address in
    the terminal.
  - `http(s)://…` addresses in the terminal open in the browser with Option+click
    (done).
- **Claude usage limits (2026-11-24, requested by the user, who also chose the
  bridge):** in the top bar, next to the session count, the 5-hour and weekly limits:
  the percentage used, a small bar and the reset time ("15:10" if today, otherwise
  "Fri 28 Nov 09:00", local time). Yellow from 70%, red from 90%; the tooltip has the
  full text and the age of the data. Claude Code gives these numbers only to the
  status line command (`rate_limits.five_hour` / `seven_day`, `used_percentage`,
  `resets_at`), so edi ships a bridge inside the package (`Resources/edi-statusline`):
  the user sets it up themselves as `statusLine` in `~/.claude/settings.json` (edi
  doesn't touch that file). The bridge only writes `rate_limits` to
  `~/Library/Application Support/edi/claude-usage.json` and prints nothing to the
  status line; edi reads the file every 5 s, doesn't show a window whose reset time
  has passed, and doesn't draw the indicator at all if the file doesn't exist. No
  network access; the option of asking Anthropic directly wasn't chosen because of the
  "no network" rule and because it would need access to the login key.
