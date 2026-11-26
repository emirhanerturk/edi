# Repository order and ignore, per project

Date: 2026-11-26. Requested by the user: in a project, put the repositories found in its folder in
their own order (`quizei-frontend` first) and ignore some (`next-quiz`, no longer used). An ignored
repo is left out entirely; if it is needed again, it is picked from the list again. Every choice
below not named so is my call.

## Why

The project's folder holds several repos and edi lists them alphabetically. The one worked on most
should lead, and a dead repo only adds noise (rows, polling, fetches).

## Goals

- Per project: an order for the repos found one level below its folder, and a set left out.
- An ignored repo is gone from edi: no Git row, no History, no Files tree, not counted in the status
  bar or on the project card, not polled, not fetched.
- Undo from the same place: the ignored repo stays in the list, unticked.

## Non-goals

- Nested folders, or folders that aren't repos (they don't show today either).
- A shortcut in the Git tab (right-click "Ignore", dragging rows). Easy to add later.
- A settings file in the project's folder: edi keeps project data in its own state, as now.

## Approaches

- **A. A REPOSITORIES section in the New/Edit project sheet** (picked): every repo found, a drag
  handle for the order, a checkbox to keep it. One place for both, and undoing an ignore happens
  where it was done.
- B. In the Git tab: drag the repo rows, right-click "Ignore". Quick in place, but an ignored repo
  leaves that list, so undoing needs a second place anyway.
- C. A `.edi.json` in the project's folder. Dropped: edi writes nothing into the user's folders.

## Design

- **Stored on the project**: `repos: { order: string[]; ignored: string[] }`, folder names (the repos
  are one level down), so a moved folder (Locate…) keeps it. Missing on older projects: alphabetical,
  nothing ignored.
- **Applied where the repos are found** (the workspace's discovery, on open and on rescan): the named
  ones in their order first, then any others alphabetically; ignored ones are dropped. Everything
  that reads the repo list follows. A repo that appears later is added at the end of the list and is
  kept; a name in the order that no longer exists is skipped.
- **The sheet**: a REPOSITORIES section before LINKS (the user: it matters more than the links), with every repo found (ignored ones unticked and
  dimmed, marked "ignored"). Order by dragging the handle, or ⌥↑/⌥↓ on a focused row. Shown only
  when the folder holds more than one repo (a folder that is itself a repo has nothing to order).
  Save applies it to the open project at once (a rescan with the new settings).
- **Repo count** on the card and in the sheet counts the kept repos.
- **Builder's call**: what happens to center tabs (diffs, files, stashes) of a repo that becomes
  ignored while open — closing them is the expected behavior. Terminals stay; a Claude session in an
  ignored repo counts as the project root's.
