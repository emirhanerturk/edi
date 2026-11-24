# Editor, Files tab and Git tab additions

Date: 2026-11-24. All of this was requested by the user in one message. The choices marked "user"
came from their answers; the rest are my calls.

## 1. Minimap

The file view's editor shows Monaco's minimap, on the right.

## 2. Changed lines in the editor

- A gutter bar marks the lines that differ from HEAD (committed or not, staged or not, the same
  base as the diff view), as VS Code does:
  - green for added lines;
  - blue for modified lines;
  - a red marker where lines were deleted.
- The editor's current text is compared with the HEAD version, so the bars follow typing.
- The main process gives the HEAD text (`git cat-file blob HEAD:<path>`). The bars are read
  again when HEAD moves (a commit, a checkout).
- No HEAD version means the whole file is added: an untracked file, or a repo with no commits.
- The line diff runs in the page (Myers on lines). Above 20,000 lines on either side there are no
  bars.

## 3. Who changed the current line

- At the end of the line holding the cursor, muted text shows: "Name, 3 days ago · subject".
- Clicking it opens that commit in the commit view.
- Lines not committed yet show "Not committed yet" and aren't clickable.
- Blame runs on the editor's current text: `git blame --porcelain --contents -`, with the text on
  stdin. Unsaved edits are therefore attributed correctly.
- It is read once for each text version, debounced while typing; the note hides while typing.
- Files over 20,000 lines show nothing. In a file without a HEAD version every line is "Not
  committed yet".

## 4. New file in the center panel

- "New file" opens an empty "Untitled-N" tab in the editor (the lowest free N). It is reached by:
  - double-clicking the empty part of the center tab bar;
  - a + button in the tab bar;
  - ⌘N, which also works while the center panel is closed (my call).
- The tab counts as unsaved once it has text (my call: an empty one closes without asking).
  Closing it with text, quitting or switching folders asks first, like any unsaved tab.
- The first ⌘S (or "Save…" in the header) opens the macOS Save panel (user). It starts in the
  active tab's repo, or the only repo, or else the open folder.
- The chosen path must be inside one of the open folder's repos (a file tab belongs to a
  repo); the panel can't stop navigation, so a path outside them is refused with a message.
- An existing file is never replaced: if the panel's "Replace" was confirmed, saving is still
  refused and the text stays (my call: the safer side).
- Once saved, the tab becomes that file's normal file tab in the same place.

## 5. Files tab: new file, new folder, rename, delete

- Right-click on a row (user) opens a native menu:
  - on a folder or repo row: New File…, New Folder…;
  - on a file or folder row: Rename…, Delete;
  - on every row: Reveal in Finder.
- Hovering a repo or folder row shows two small buttons: new file and new folder. When the
  open folder is a single repo (no repo row), the same two buttons sit in the Files tab header
  and add to the repo root.
- Keyboard: F2 renames the focused row, ⌘⌫ moves it to the Trash (my call).
- New names are typed inline in the tree, at the top of the target folder; renames are typed in
  place.
  - Enter confirms; Escape or clicking away cancels.
  - Names with `/`, or names `.` or `..`, are refused. So are existing names.
- A new file opens in the editor right away.
- Empty folders are listed too (git leaves them out), so a new folder shows at once.
- Delete asks first, then moves the item to the macOS Trash (`shell.trashItem`), so it can be
  recovered.
- Everything goes through the main process, which validates the repo and path. Nothing inside
  `.git`, and nothing outside the repo.
- Open file tabs of a renamed file (or of files in a renamed folder) follow it to the new path,
  in place; those of a trashed one close. If such a tab has unsaved edits, the action asks
  first: the tab reloads from disk, so the edits would be lost.
- A failure that has no name field (Trash, Finder) shows as a line at the top of the tree.

## 6. File icons in the Files tab

- Monochrome, muted icons by file type (user), from Lucide (ISC license).
- Icons cover: code, JSON, Markdown/text, images, video, archives, config files (dotfiles,
  `*.config.*`), lock files, shell scripts, and a plain file for the rest.
- Folders keep the chevron and get a folder icon (open or closed).

## 7. Unpushed commits in the Git tab

- Under an expanded repo with commits ahead of its upstream, a section "Unpushed N" lists them
  (at most 50): subject, short hash and relative time. A repo with only unpushed commits still
  starts collapsed, so its row keeps the "Push n" button (my call).
- Clicking one opens it in the commit view.
- The newest one has an "Undo commit" button (user): `git reset --soft HEAD~1`. Its changes come
  back staged, nothing is lost, and pressing it again undoes the next one.
- It asks first, and is offered only when:
  - the commit isn't on the upstream (checked again in the main process just before running);
  - HEAD isn't a merge commit;
  - the commit isn't the repo's root commit.
- No upstream: no section. "Unpushed" can't be told apart then.

## 8. Collapsible Staged and Changes

- The section headers in the Git tab (Staged, Changes, Conflicts, Unpushed) get a chevron on the
  left. Clicking the header collapses or expands the section.
- The state is remembered per section kind for the session.

## Non-goals

- Inline diff peeking from the gutter bars, or staging hunks from the editor.
- Blame for the whole file at once.
- Undoing any unpushed commit other than the newest one, or reverting pushed commits.
