# Stash

Date: 2026-11-25. Requested by the user in one message: add git stash, a feature they use a lot,
in the way that fits the interface best, and think about a single repo and several repos
separately. Every choice below is my call unless it says otherwise.

Until now stash was a non-goal of the first version (`2026-11-24-edi-desktop-app-design.md`).

## What a stash is in edi

- **Stash takes everything the Git tab lists.** Staged changes, unstaged changes and new files
  (`git stash push --include-untracked`), so the repo turns clean, the way "Commit all" takes new
  files too. Ignored files stay where they are. (Plain `git stash` leaves new files behind; in a
  list that shows them under Changes that would look like a stash that didn't work.)
- **Pop brings it back as it was.** `git stash pop --index`: what was staged comes back staged.
  If the staged part no longer applies (the index moved on), it is applied again without
  `--index`; nothing is lost, only the staged/unstaged split.
- **A stash is named by its commit id**, never by its position: `stash@{n}` shifts whenever
  another stash is added or dropped. The main process finds the position just before running
  and checks it still names the same commit.

## Git tab

### Stashing

- An expanded repo with changes has a **Stash button** (archive icon) next to the commit
  button's arrow. It opens a small menu:
  - the stash's message: the commit box's text, on one line (no field of its own; with the box
    empty it says "No message: type one in the commit box"). "Stash all changes" has the focus,
    so Enter stashes everything. A stash that goes through clears the commit box, as a commit does;
  - **Stash all changes · N files** (N is the count the repo shows);
  - **Stash staged changes · N files** (`git stash push --staged`), offered when something is
    staged and something else isn't. Disabled while a file is partly staged: git can't take only
    the staged half of such a file reliably (tried: it saves the stash and then fails to clean
    the working tree).
- Without a message git writes its own ("WIP on main: 1a2b3c4 subject"). A message is kept to one
  line.
- Disabled while an operation runs and while there are conflicts (git refuses anyway). Not
  offered before the first commit (git can't stash then).
- With nothing to stash there is no button: it lives in the commit box, which shows only when
  there are changes.

### The STASHES section

- In an expanded repo, under Unpushed: **STASHES n**, newest first, collapsible like the other
  sections (remembered for the session).
- A row: the message (or "WIP" and the subject it was made on), the branch it was made on when
  that isn't the current branch (the branch is the thing to notice when you come back), the
  relative time and a **Pop** button. The tooltip is git's own line.
- Click previews the stash in the center panel, double click pins it, Enter opens it.
- **Right-click** opens a native menu: Pop, Apply, Drop….
- A clean repo with stashes shows "No changes" above the section.

### Collapsed rows

- A collapsed repo with stashes shows a muted archive icon and the count after its status
  (`✓ ⊟2`): parked work in a collapsed repo is easy to forget.
- The count comes from the status poll (`git status --porcelain=v2 --show-stash`), so it costs no
  extra git process; the list itself is read only for an expanded repo, again whenever the
  count changes.

### Several repos

- Each repo stashes on its own; there is no "stash every repo" (stashing is a per-repo
  decision, and a bulk stash would hide work in many places at once).
- The STASHES section shows the newest five; **Show N more** lists the rest for the session.
  Eight repos sit one under another, and one long list shouldn't push the others off screen.
- The collapsed-row count is what keeps stashes in sight.

### A single repo

- When the open folder is itself a repo, its row **starts expanded when it has stashes**, even
  when clean: there is nothing else in the panel, and a collapsed row would hide the list behind
  a click. Collapsing it by hand still wins, as for any repo.
- The section lists every stash (up to 100); the whole panel is free, so no "Show more".

### When git refuses because of local changes

- Switching branches or pulling fails when local changes would be overwritten. The error now
  names the files ("Your local changes to README.md would be overwritten by checkout"; git's own
  line ended in a colon, with the files on the lines edi didn't show), under the title "Local
  changes are in the way", and offers **Stash and switch** (or **Stash and pull**): it stashes
  all changes and runs the switch or pull again, as one operation. The stash stays in the list;
  pop it when you come back (it shows the branch it came from).
- If the stash works and the switch or pull still fails: "Stashed your changes, but the switch
  failed: …".

## Stash view (center panel)

- A stash opens in the center panel like a commit, with an archive icon on its tab.
- Header: the message (or "WIP on main"), then the branch it was made on, the repo, when, and the
  commit it was made on top of (short hash and subject); `+/−` totals, collapse/expand all, copy
  hash. Buttons: **Pop**, **Apply**, **Drop…**.
- Below: every file's diff against the commit it was made on (staged and unstaged together, as
  in the diff view); new files are listed with `?` and their content, as in the Git tab.
- It reads once. If the stash leaves the list (popped or dropped from a terminal), the view says
  so and its buttons go away. Popped or dropped from edi, its tab closes.

## Safety

- **Drop asks first** (native question: "Drop the stash …? The stashed changes are deleted. This
  cannot be undone."). It is the only stash action that deletes anything.
- **Pop and apply never lose the stash**: on a conflict, or when git refuses, the stash stays in
  the list. Git refuses by itself when the stash would overwrite local changes; edi shows its
  error with the file names.
- **New files are checked before applying.** If a file the stash would restore as new already
  exists, edi refuses before git runs ("notes.txt already exists; move it away before applying
  this stash"). Git would otherwise apply the tracked part, fail on the new files and leave a
  half-applied stash (tried with git 2.43).
- **Conflicts:** pop and apply are refused while the repo has conflicts. A pop that ends in
  conflicts leaves them in the Conflicts section as any other conflict, and says "Applied with
  conflicts; the stash is kept".
- If stashing fails after git saved the stash (it couldn't clean the working tree), edi says the
  stash was saved, rather than showing a bare error.
- A nested repository is left alone by git. With nothing else to stash, git still saves an empty
  stash (tried with git 2.43); edi drops that one again, as it just made it and it holds nothing,
  and says "Nothing to stash: git leaves nested repositories alone (…)".
- Every operation goes through the main process with the repo path checked against the
  discovered list, one operation per repo at a time; the stash id must be a full commit id and
  must still be in the list.

## Non-goals

- Stashing single files (`git stash push -- <path>`), `--keep-index`, `stash branch`, clearing
  every stash at once, renaming a stash.
- Stashes in the History timeline.
- Applying or popping automatically after a switch or pull ("autostash"): the stash stays until
  you pop it.
- Undoing a drop.
