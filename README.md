# edi

A terminal manager with Git built in, for working across several repositories at once.
It is not an IDE: there is no editor. You open a project — a folder with a name, a logo and its
links — run your shells and Claude Code sessions in tabs on the left, and see every repository
under that folder — branch, changes,
what is waiting to be pushed or pulled — on the right. Staging, committing and syncing happen
from that list.

macOS only for now. Electron, React, xterm.js and node-pty.

## What it does today

- **Projects.** edi opens on the Projects screen and opens nothing on its own: every project as a
  card in a grid, last opened first, the last one marked "Last opened" (Enter opens it). A project
  is a folder with a name, a logo and links. New project (⌘O) picks the folder, then a sheet
  suggests the folder's name, the images in it that look like a logo (favicon, logo, icon files)
  and, for a single repository with a remote on GitHub, GitLab, Bitbucket or Codeberg, its page;
  any other image can be chosen, or the name's first letter on one of six colors. A project has any
  number of links; the starred one is the main link. Right-click a card (or its … button) for its
  links, Edit project…, Reveal in Finder and Remove from list; a project whose folder has moved
  offers Locate…. The folders opened before projects existed become projects named after them.
- **Title bar.** The open project's logo and name sit at the left, right after the window buttons;
  its menu edits the project, switches to another one (asking first if a terminal is busy), shows
  All projects (⇧⌘O, over the open project, which keeps running; Esc goes back) or starts a new
  one. Beside it the main link is written out with ↗ (a click opens it in the browser), and +N opens
  the other links.
- **Claude usage.** The 5-hour and weekly limits in the title bar, with reset times; a window that
  hasn't started yet shows 0% (see [Install](#install) for the one-line setup).
- **Terminals.** Real login shells (`$SHELL -l`) in tabs. A tab is named after the process
  running in front; Claude Code tabs carry a mark, and a bell when a background session
  stops working and waits for you. A click on + or ✳+ lists the project folder and its
  repositories, with the Claude Code sessions open in each, to start the terminal or session in one
  of them (⌥⌘T and ⌥⇧⌘T open the lists from the keyboard; ⌘T and ⇧⌘T open in the project folder at
  once). A repository's row in the Git tab has the same two buttons. A tab started in a repository
  shows its name after the tab's. Drag a tab to put it in another place: a line shows where it will
  land, before or after the tab under the pointer; ⌘1–⌘9 follow the new order.
- **Snippets.** A project keeps commands you run often, each with a name, an optional group, the
  folder it runs in (the project folder or one of its repositories) and one or more lines. The
  button left of + in the terminal tab bar lists them by group; a click runs one in a new tab named
  after it, typing its lines one by one as if you typed them; ⌥-click types it at the open
  terminal's prompt without running it. A snippet marked "Ask before running" asks first.
  Right-click one to edit, duplicate or delete it. Snippets are saved with the project in edi's own
  state file, not in a repository.
- **Git tab.** Every repository directly under the open folder, refreshed every two seconds.
  A collapsed row shows the branch, the state and one sync button; an open repository lists
  conflicted, staged and changed files with a commit box, which stays with its buttons greyed out when
  there is nothing to commit; each group folds. Stage, unstage,
  commit, commit and push, pull, push, fetch all, switch and create branches. Commits not
  pushed yet are listed under the repository; the newest can be undone (its changes come
  back staged). Right-click a changed file to open its change or the file, open it in an editor,
  stage, unstage or discard it, copy its path or show it in Finder. Every repository with a remote is
  fetched in the background every three
  minutes and when you come back to the window (View > Fetch Automatically turns it off);
  the commits a pull would bring are listed as Incoming, with who made each.
- **Stash.** The button next to Commit stashes every change, new files included (or only the
  staged ones), with an optional message. Stashes are listed under the repository, newest
  first, with the branch they came from; Pop brings one back as it was (staged files staged),
  right-click for Apply and Drop. A collapsed repository shows how many it has; the list
  starts folded. Clicking a stash shows its diff in the center panel, where it can also be
  renamed. When a switch or pull is refused because of local changes, the error
  offers "Stash and switch" (or pull).
- **Center panel.** Closed until you open something. Clicking a changed file in the Git tab
  shows its whole change against HEAD (staged and unstaged together), side by side or inline,
  with syntax colors; a new file opens with its content. A single click opens a preview tab
  that the next click reuses, a double click keeps the tab. The open view follows the file
  as it changes on disk. Open file shows the whole file next to its diff. ⌘N (or the + in
  the tab bar) opens a new untitled file; the first ⌘S asks where to save it.
- **Files tab.** Each repository's working tree; files and folders ignored by git are dimmed
  (an ignored folder is read from disk one level at a time when you open it). Changed files carry
  their status letter, folders that contain changes a dot; files carry an icon by type. Right-click
  (or the buttons on a folder row) for New File, New Folder, Copy and Paste (Finder can paste a copied
  file too), Duplicate, Copy Path, Copy Relative Path, Rename, Delete (to the Trash, after asking),
  Open in an editor, a new terminal in a folder, and Reveal in Finder; the keys the menu shows work on
  the selected row. Clicking a file opens it in an editor (Monaco, with the same colors as the diff view,
  and a minimap); ⌘S saves. Bars in the gutter mark lines changed since HEAD, and the cursor's
  line shows who changed it last; clicking that opens the commit. If an agent changes the file under
  unsaved edits, a bar offers "Load disk version" or "Keep mine"; closing an edited tab, quitting
  or switching folders asks first. Images and videos open as a preview. Other files over 1 MB and binary files are not shown.
- **Quick open.** ⌘P finds a file by its name or path in every repository of the project, grouped by
  repository with the best match first; files ignored by git are left out. The arrow keys move, Enter
  opens the file (⌘Enter keeps it in a tab); with nothing typed it lists the files opened last.
- **Search tab.** Finds text in every repository's files (those git lists; ignored ones are left out),
  as typed, as a whole word or as a regular expression, with or without matching case, in one
  repository or all, and only in the files to include (`src/**, !*.test.ts`). Results are grouped by
  repository and file; clicking one opens the file at that line. Replace shows each change before it
  is made; a line, a file or every result can be replaced, and Replace All asks first. ⇧⌘F opens it,
  and Find in Folder… in the Files tab searches a folder. Files over 1 MB and binary files are not
  searched.
- **History tab.** The recent commits of every repository's current branch in one timeline,
  under day headers, newest first; or grouped by repository. Commits not pushed yet carry an
  arrow, a version commit shows as a tag line, merges are dimmed. Filter to one repository to
  see where its upstream stands. 50 commits per repository at a time, with "Load 50 more".
- **File history.** File History (in a file's right-click menu in the Files and Git tabs, the
  History button of the file and diff views, and beside each file in the commit view) opens a tab
  with the commits that changed the file, following it through renames, with its uncommitted changes
  first; the selected one's change to the file shows below, and Open commit opens the whole commit.
- **Commit view.** Clicking a commit opens it in the center panel: message, author,
  repository, branch, time, totals, a copy button for the hash, a GitHub link once the commit
  is pushed, and every changed file's diff one under another. A changed image or video shows the
  version before and after side by side, with sizes; an added or deleted one shows alone. The Git
  tab's diff and the stash view do the same. Files with more than 400 changed
  lines start collapsed, and so do the rest once the open ones reach 3,000 lines together; one
  button expands or collapses them all.
- **Running servers.** A dev server started in a terminal (`npm run dev` and the like) shows
  in the status bar with its localhost port, repository and terminal, found from the
  terminal's processes rather than its output; clicking it opens the address in the browser.
  The terminal tab shows the port. Links in terminal output open with Option-click.
- **Open in…** Antigravity or Zed from the file and diff views, and for conflicted files in
  the Git tab.
- **Layout.** View > Layout puts the terminals on the right and the Git, History and Files
  panel on the left.
- **Keep Mac Awake.** View > Keep Mac Awake stops the Mac from going to sleep on its own while
  edi is open, so a long Claude Code session or build keeps running. The display may still
  turn off, and closing a laptop's lid still puts it to sleep. Off unless you turn it on.
- **Remembers** the projects and their snippets, the window position, the panel widths and
  sides, the diff layout and the History layout.

- **The `edi` command.** `edi <folder>` opens that folder's project in edi from any terminal;
  `edi .` the current folder's, `edi` alone brings edi to the front. A folder that isn't a project
  yet gets the New project sheet, filled in. When edi is already open, the same window switches
  (asking first if a terminal is busy).

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

`⌘O` starts a new project, `⇧⌘O` shows all projects, `⌘P` opens a file by name, `⇧⌘F` searches the files, `⌘T` a terminal, `⇧⌘T` a Claude Code session (`⌥⌘T` and `⌥⇧⌘T` ask in which
repository), `⌘W` closes the tab
of the panel in use (the terminal, or the file or diff in the center panel), `⌘1`–`⌘9` switch tabs.

## Install

```sh
npm run dist     # build edi.app, install it and the edi command
```

`npm run dist` builds an unsigned (ad-hoc signed) `edi.app` with the wordmark icon, copies it
to `/Applications/edi.app` and links `~/.local/bin/edi` to the command inside it. Run it
again to update. It stops without changing anything while edi is running, and it never
overwrites an `edi.app` or an `edi` command that is not edi's. `npm run dist -- --no-install`
only builds, into `release/`.

### Claude usage in the title bar

edi shows your Claude 5-hour and weekly limits (percent used and when each resets) next to
the session count. Claude Code hands these numbers only to a status line command, so edi
ships a small bridge for it. Add this to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "/Applications/edi.app/Contents/Resources/edi-statusline" }
```

The bridge writes only the `rate_limits` part to
`~/Library/Application Support/edi/claude-usage.json` and prints nothing, so Claude Code's
own status line stays empty. The numbers refresh whenever a Claude Code session updates its
status line; nothing goes over the network.

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
  with `--no-verify`. There is no discard button. Undoing a commit is `reset --soft HEAD~1`
  on a commit that isn't pushed, after asking; nothing in the working tree changes.
- **Stashes are kept until you drop them.** Stashing saves before it cleans the working tree;
  pop and apply leave the stash in the list on a conflict or a refusal, and refuse before git
  runs when a new file of the stash is already there (git would apply it halfway). Dropping a
  stash asks first; it is the only stash action that deletes anything. A stash is named by
  its commit id, never by its position, which shifts.
- **Files change only on purpose.** Saving writes only if the disk still holds the text the
  edit started from. New files and folders, copies, and renames never replace an existing one.
  Deleting moves to the macOS Trash, after asking. A search's replacement is written only if the
  file still holds the text that was searched; files with unsaved edits in a tab are left alone, and
  Replace All asks first. A search pattern runs in the main process under a time limit, so one that
  would run for ever is stopped.
- **Nothing automatic.** No background fetch, pull or push. The network is touched only when
  you press Fetch, Pull, Push or Publish.
- **The page cannot run commands.** The window is sandboxed and talks to the main process
  through a small typed bridge. A Git operation names a repository by path, and the main
  process accepts only the exact paths it discovered itself; an operation is one of a fixed
  list, never free text. A commit message is passed to Git as a single argument. A snippet is
  run by its id: the main process types the command it saved into a new terminal, in the folder it
  checks is still the project's, and asks first when the snippet says so.
- **Reading files stays inside the repository.** The page names a file by its path in a
  discovered repository; the main process resolves symlinks and refuses anything that leads
  outside it or into any `.git` folder. Viewing never writes; creating, renaming and trashing
  go through the same check. A commit is named by its hex id
  and must resolve to a commit in that repository before Git reads it.
- **Projects touch only edi's own files.** The page names a project by its id; only the main
  process turns it into a folder. Removing a project from the list, after asking, only forgets
  it: the folder and its repositories stay as they are. A logo is a copy edi keeps in its own
  folder (`logos/`, beside its state file), checked first to be an image of at most 2 MB whose
  content is the type its name says; the page can show only those copies and the images the main
  process offered in the sheet, never a path of its own.
- **Links open in the browser, nowhere else.** Only http and https addresses are kept and opened,
  without a user name or password in them. edi never loads a link itself: no favicon is fetched,
  a logo comes from the folder or a file you pick.
- **One operation per repository at a time.** A second one is refused while the first runs.
- **Conflicts are resolved elsewhere.** edi shows them and blocks committing; it does not
  try to resolve them.
- **Your Claude Code is left alone.** edi never edits `~/.claude`, injects hooks, wraps the
  `claude` command or pretends to be another terminal. It reads the process list and the
  terminal title, nothing more.
- **No telemetry, no network.** Fonts are bundled. The app makes no requests of its own.
- **Asks before closing running work.** Quitting, closing a tab, switching projects or removing
  the open one asks first when a terminal still has a running process.

## Layout

```
src/git/        Git commands, status and diff parsing, file listing (no Electron)
src/main/       main process: workspace polling, Git operations, terminals, projects and logos, saved state
src/preload/    the bridge exposed to the page
src/renderer/   the React interface
src/shared/     types and pure rules shared by both sides
tests/, e2e/    unit and end-to-end tests
docs/           design, plans and notes
```
