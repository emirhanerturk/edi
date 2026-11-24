# edi

A terminal manager with Git built in, for working across several repositories at once.
It is not an IDE: there is no editor. You open a folder, run your shells and Claude Code
sessions in tabs on the left, and see every repository under that folder — branch, changes,
what is waiting to be pushed or pulled — on the right. Staging, committing and syncing happen
from that list.

macOS only for now. Electron, React, xterm.js and node-pty.

## What it does today

- **Terminals.** Real login shells (`$SHELL -l`) in tabs. A tab is named after the process
  running in front; Claude Code tabs carry a mark, and a bell when a background session
  stops working and waits for you.
- **Git tab.** Every repository directly under the open folder, refreshed every two seconds.
  A collapsed row shows the branch, the state and one sync button; an open repository lists
  conflicted, staged and changed files with a commit box. Stage, unstage, commit, commit and
  push, pull, push, fetch all, switch and create branches.
- **Center panel.** Closed until you open something. Clicking a changed file in the Git tab
  shows its whole change against HEAD (staged and unstaged together), side by side or inline,
  with syntax colors; a new file opens with its content. A single click opens a preview tab
  that the next click reuses, a double click keeps the tab. The open view follows the file
  as it changes on disk.
- **Files tab.** Each repository's working tree, without ignored files; changed files carry
  their status letter, folders that contain changes a dot. Clicking a file opens it read-only.
  Files over 1 MB and binary files are not shown.
- **History tab.** The recent commits of every repository's current branch in one timeline,
  under day headers, newest first; or grouped by repository. Commits not pushed yet carry an
  arrow, a version commit shows as a tag line, merges are dimmed. Filter to one repository to
  see where its upstream stands. 50 commits per repository at a time, with "Load 50 more".
- **Commit view.** Clicking a commit opens it in the center panel: message, repository,
  branch, time, totals, a copy button for the hash, and every changed file's diff one under
  another. Files with more than 400 changed lines start collapsed.
- **Running servers.** A dev server started in a terminal (`npm run dev` and the like) shows
  in the status bar with its localhost port, repository and terminal, found from the
  terminal's processes rather than its output; clicking it opens the address in the browser.
  The terminal tab shows the port. Links in terminal output open with Option-click.
- **Open in Zed** from the file and diff views, and for conflicted files in the Git tab.
- **Remembers** the last folder, recent folders, the window position, the panel widths, the
  diff layout and the History layout.

- **The `edi` command.** `edi <folder>` opens that folder in edi from any terminal; `edi .`
  opens the current one, `edi` alone brings edi to the front. When edi is already open, the
  same window switches to the folder (asking first if a terminal is busy).

## Setup

Requires Node 22 or newer and Git.

```sh
npm install && npm run setup
```

`npm run setup` prepares the native terminal module and downloads Electron.

## Running

```sh
npm run dev      # app with live reload
npm run build    # build into dist/
npm start        # run the built app
```

The development copy keeps its settings in a folder of its own (`edi-dev`), apart from the
installed app.

`⌘O` opens a folder, `⌘T` a terminal, `⇧⌘T` a Claude Code session, `⌘W` closes the tab,
`⌘1`–`⌘9` switch tabs.

## Install

```sh
npm run dist     # build edi.app, install it and the edi command
```

`npm run dist` builds an unsigned (ad-hoc signed) `edi.app` with the wordmark icon, copies it
to `/Applications/edi.app` and links `~/.local/bin/edi` to the command inside it. Run it
again to update. It stops without changing anything while edi is running, and it never
overwrites an `edi.app` or an `edi` command that is not edi's. `npm run dist -- --no-install`
only builds, into `release/`.

Opened from the Dock, edi reads your login shell's environment once at startup, so git hooks
find `node` and other tools from your shell's `PATH`. `npm run icon` regenerates
`build/icon.icns` from `docs/design/icon/wordmark.svg`.

## Tests

```sh
npm test         # unit and component tests (Vitest)
npm run e2e      # builds, then drives the real app (Playwright)
npm run e2e:dist # drives the packaged app; run `npm run dist -- --no-install` first
npm run typecheck
```

Tests only ever touch temporary folders and local bare remotes. They never read or write a
real repository and never reach the network.

## Safety rules

edi runs Git on repositories that hold real work. These rules are part of the design, not
preferences:

- **Nothing destructive.** The code never runs `reset --hard`, `checkout -- <path>`,
  `restore` on the working tree, `clean`, a force push, `rebase`, `fetch --prune` or anything
  with `--no-verify`. There is no discard button.
- **Nothing automatic.** No background fetch, pull or push. The network is touched only when
  you press Fetch, Pull, Push or Publish.
- **The page cannot run commands.** The window is sandboxed and talks to the main process
  through a small typed bridge. A Git operation names a repository by path, and the main
  process accepts only the exact paths it discovered itself; an operation is one of a fixed
  list, never free text. A commit message is passed to Git as a single argument.
- **Reading files stays inside the repository.** The page names a file by its path in a
  discovered repository; the main process resolves symlinks and refuses anything that leads
  outside it or into any `.git` folder. Viewing never writes. A commit is named by its hex id
  and must resolve to a commit in that repository before Git reads it.
- **One operation per repository at a time.** A second one is refused while the first runs.
- **Conflicts are resolved elsewhere.** edi shows them and blocks committing; it does not
  try to resolve them.
- **Your Claude Code is left alone.** edi never edits `~/.claude`, injects hooks, wraps the
  `claude` command or pretends to be another terminal. It reads the process list and the
  terminal title, nothing more.
- **No telemetry, no network.** Fonts are bundled. The app makes no requests of its own.
- **Asks before closing running work.** Quitting, closing a tab or switching folders asks
  first when a terminal still has a running process.

## Layout

```
src/git/        Git commands, status and diff parsing, file listing (no Electron)
src/main/       main process: workspace polling, Git operations, terminals, saved state
src/preload/    the bridge exposed to the page
src/renderer/   the React interface
src/shared/     types and pure rules shared by both sides
tests/, e2e/    unit and end-to-end tests
docs/           design, plans and notes
```
