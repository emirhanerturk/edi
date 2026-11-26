# Projects

Date: 2026-11-25. Requested by the user: instead of folders, projects — a folder with a title, a
logo and links; the project's name and logo small in the title bar; at startup no folder opens on
its own, the projects show as a grid with a badge on the last one opened, and a new project can be
made from there. The design was settled first on the canvas (`edi UI design`: Projects — welcome
screen, New project, Projects — title bar and links, Projects — cards, logos and startup), then
the user asked for several links (the main one written out, with an icon that says it opens) and a
more usable title bar. Every choice below not named so is my call.

## What a project is

- **A folder with a name, a logo and links.** The folder is its real path; its git repositories
  are what the project shows, as a folder did before. The name defaults to the folder's.
- **The logo** is an image or a letter. An image is a copy edi keeps in `logos/` beside its state
  file, so the logo stays when the file it came from changes or goes; a letter is the name's first
  letter on one of six colors (purple, blue, cyan, green, orange, gray), the default picked from the
  folder's path so projects made without a choice don't all share one.
- **Links**: any number (at most twelve), each an address and an optional label. The first one is
  the main link, written out in the title bar. Only http and https; `https://` is added when no
  scheme is typed (`http://` for a local address); an address with a user name or password is refused.
- **Last opened** time and repo count, for the cards and the order.
- Folders opened before projects existed (the old `recent` list and `lastDir`) become projects named
  after their folder, with a letter; the last folder opened gets the time of the migration, so it
  carries the badge.

## Startup and `edi <folder>`

- edi starts on the **Projects screen** and opens nothing on its own.
- `edi <folder>`: the folder's project opens; a folder that isn't a project yet gets the New project
  sheet, filled in. With edi already open, the same window takes it: a switch asks first if a terminal
  is busy, as before.
- `EDI_OPEN_DIR` (tests and development) opens the folder as it is, making it a project if needed.

## The Projects screen

- A grid of cards, four across, last opened first, then the dashed **New project** card; a **New
  project** button with ⌘O at the top right. Hints underneath: ↵ open, arrows move, right-click.
- A card: logo, name, folder (`~/…`), repo count, the main link and `+N`, and when it was last
  opened (Today, Yesterday, the weekday within a week, then the date).
- Badge: **Last opened** on the first card; when the screen is shown over the open project, **Open**
  on that one instead (its card shows its Claude Code sessions).
- The keyboard starts on the first card (Enter opens the last project), or on the open project's
  card over it; the arrows move between cards.
- A click opens the project. The **… button** (on hover) and a right-click give a native menu: Open,
  each link, Edit Project…, Reveal in Finder, Remove from List….
- A project whose folder has moved: "Folder not found", **Locate…** (the folder panel) and **Remove
  from list**.
- **All projects** (⇧⌘O, and in the title bar's menu) shows the screen over the open project, which
  keeps running; Esc, or a click on its card, goes back. Picking another project switches.

## The New project and Edit project sheet

- ⌘O and New project open the folder panel first. A folder that already is a project just opens;
  any other opens the sheet with the folder's name, the images found in it and, for a folder holding
  a single repository whose remote is on GitHub, GitLab, Bitbucket or Codeberg, the repository's page
  as the main link (read from the remote's URL; nothing is fetched).
- **Folder**, with Change…; the repo count, or "This folder is already the project X." (Create is
  then disabled). The open project stays in its folder: no Change… in its sheet.
- **Name**, focused and selected.
- **Logo** tiles: the current image (editing), up to four images found in the folder (the likeliest
  first: logo, wordmark/brand, icon, favicon; SVG before PNG; shallower first; never in dependency
  folders or ignored files), images picked with Choose…, and Letter, which shows the six colors. The
  picked tile's path is written under them.
- **Links**: rows of address and label, a star for the main one, a remove button; Add link. An
  address that isn't a web address turns red and stops Create.
- **Repositories** (since 2026-11-26, see `2026-11-26-edi-repo-order-design.md`): before Links, the
  repos found in the folder in the project's order; drag or ⌥↑/⌥↓ to reorder, untick to ignore.
- Edit project… has **Save** and **Remove from list**. Removing asks first ("Remove "X" from the
  list?"), says the folder stays, and closes the open project first (asking if a terminal is busy).

## The title bar

- At the left, right after the window buttons, in place of the app's name: the project's logo and
  name with a chevron. Its menu: the project and its folder, Edit project…, Reveal in Finder, RECENT
  (up to five other projects), All projects ⇧⌘O, New project… ⌘O.
- Beside it, after a thin divider: the main link written out with ↗; a click opens it in the
  browser. With more links, `+N` opens a menu of all of them (the main one starred, label and host,
  ↗) and Edit links….
- A project without links shows neither. With no project open, the app's name.
- The middle is left free to drag the window; the right side (sessions, usage) is as it was.

## Safety

- The page names a project by its id; only the main process turns it into a folder.
- A logo is shown through `edi-logo:`, which serves only edi's copies (`logo/<file>`, a name it made)
  and the images it offered in the sheet (`found/<id>`). An image must be a known type (PNG, JPEG,
  GIF, WebP, AVIF, SVG, ICO), at most 2 MB, with content of that type; one found in a folder must not
  lead out of it. An SVG shown through `<img>` runs no script; the response also forbids it.
- Links open only in the browser, through the same check as terminal links.
- Removing a project deletes nothing but its logo copy.
