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
- **Open in Zed** from the file and diff views, and for conflicted files in the Git tab.
- **Remembers** the last folder, recent folders, the window position, the panel widths and
  the diff layout.

History and packaging are planned next; see `docs/superpowers/`.

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

`⌘O` opens a folder, `⌘T` a terminal, `⇧⌘T` a Claude Code session, `⌘W` closes the tab,
`⌘1`–`⌘9` switch tabs.

## Tests

```sh
npm test         # unit and component tests (Vitest)
npm run e2e      # builds, then drives the real app (Playwright)
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
  outside it or into `.git`. Viewing never writes.
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
