# Editing files in the center panel

Date: 2026-11-24. Requested by the user: edit an opened file in edi instead of switching to Zed
for a small change. "Open in Zed" stays for bigger work.

Later the same day the user asked for more: a minimap, new and untitled files, renames and the
Trash are now in. See `2026-11-24-edi-editor-files-git-design.md`; the non-goals and Monaco
options below are as first decided.

## Goals

- A text file opened in the file view is editable, with the editor feel of VS Code (Monaco):
  undo, multi-cursor, find, and the usual shortcuts.
- Colors stay exactly as they are now: Shiki with One Dark Pro, as in the diff and commit views.
- ⌘S saves the file.
- Agents in the terminals often change the same files. An edit must never silently overwrite their
  work, and their work must never silently throw away an unsaved edit.

## Non-goals

- Language services (completion, errors, go to definition). Zed is there for that.
- Editing in the diff or commit views, or editing images, binary files or files over 1 MB.
- Creating, renaming or deleting files.
- Auto-save.

## Approaches

- **Monaco with Shiki colors** (picked; the user asked for Monaco). Only the editor core and its
  editing features are bundled: no Monaco languages, TypeScript service or LSP client.
  `@shikijs/monaco` feeds the existing Shiki grammars and theme into Monaco. It is a few MB in a
  local app, loaded only when a file view opens.
- Monaco's own Monarch grammars and themes: rejected, because the colors would differ from the
  diff view and the highlighting is coarser.
- CodeMirror 6: lighter, but the user asked for Monaco's feel, and size doesn't matter much in a
  local Electron app.

## When the file changes on disk (the user picked option A)

The view still re-reads the file on every repo status poll.

- **No unsaved changes:** the editor quietly takes the disk version. The undo history is kept, and
  the replacement is one undo step.
- **Unsaved changes, and the disk version changed since it was loaded or last saved:** a bar
  above the editor says "This file changed on disk." It has two buttons:
  - **Load disk version:** drops my changes.
  - **Keep mine:** hides the bar; the next save overwrites the disk.
- **Unsaved changes, and the file was deleted on disk:** the bar says so, with **Close** (drops
  my changes) and **Keep mine**. Saving then fails with "The file no longer exists" (my call:
  no file creation).
- **Saving re-checks the disk.** Save sends the text it was based on. If the disk no longer
  matches it (an agent wrote between the last poll and the save), nothing is written and the bar
  appears. "Keep mine" makes the next save write regardless.

## Unsaved changes elsewhere

- **Tab:** a dot in place of the close button. Hovering the dot shows the close button.
- **Header:** an "Unsaved" mark and a Save button.
- **Preview tab:** the first edit pins it, so a single click elsewhere doesn't replace it.
- **Edits survive switching tabs:** each open file keeps its Monaco model, with its undo
  history, until its tab closes.
- **Closing a tab with unsaved changes** asks first, with a native dialog: "Discard changes" or
  "Cancel".
- **Quitting or switching folders** with unsaved changes asks first. The existing "a terminal is
  still running" question gains a line, or is asked on its own when no terminal is busy.

## Saving

- The main process writes only inside a discovered repo, and the path goes through the same
  check as reading (links resolved, no `.git`).
- The file must exist and be a regular file.
- The write is atomic: a temp file in the same folder, then a rename. The file's permission bits
  are kept.
- Text is UTF-8. Line endings are kept as Monaco found them.
- At most 5 MB of text.

## Left to the builder

- Monaco options: no minimap; IBM Plex Mono at the current file view size; current line
  highlight; no ligatures.
- Exact wording beyond the strings above.
- How the dirty state is shared with the main process for the quit prompt.
