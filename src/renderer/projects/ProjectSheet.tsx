import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { LogoCandidate, ProjectInput } from '../../shared/api';
import { LOGO_COLORS, type LogoColor, MAX_LABEL, MAX_LINKS, MAX_NAME, colorFor, normalizeLink } from '../../shared/projects';
import { edi } from '../bridge';
import { CloseIcon, FolderIcon, PlusIcon, StarIcon } from '../components/icons';
import { plural, tildify } from '../format';
import { type SheetState, useApp } from '../store';
import { LetterLogo } from './ProjectLogo';

/** The logo picked in the sheet: the project's current image, an image offered (found or chosen), or the letter. */
type LogoPick = { kind: 'keep' } | { kind: 'candidate'; id: string } | { kind: 'letter' };

interface LinkRow {
  key: number;
  url: string;
  label: string;
}

interface Tile {
  key: string;
  pick: LogoPick;
  /** Under the tile. */
  label: string;
  /** Under the tiles when it is picked; `path` is set in mono. */
  caption: { lead: string; path: string };
  /** The image; null for the letter. */
  url: string | null;
  aria: string;
}

let rowKeys = 0;
const rowsOf = (links: { url: string; label: string }[]): LinkRow[] => links.map((link) => ({ key: ++rowKeys, url: link.url, label: link.label }));
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const samePick = (a: LogoPick, b: LogoPick) => a.kind === b.kind && (a.kind !== 'candidate' || (b.kind === 'candidate' && a.id === b.id));
const invalidLink = (row: LinkRow) => row.url.trim() !== '' && normalizeLink(row.url) === null;
const COLOR_NAMES: Record<LogoColor, string> = { purple: 'Purple', blue: 'Blue', cyan: 'Cyan', green: 'Green', orange: 'Orange', gray: 'Gray' };

/** Under the links: what the starred one and the others do. */
function linksHelp(links: LinkRow[]): string {
  const others = links.filter((row) => row.url.trim() !== '').length - 1;
  if (links.length === 0) return 'A site, an admin panel, a store page… The starred one is written out in the title bar.';
  if (others <= 0) return 'Written out in the title bar, with ↗ to open it.';
  return `The starred one is written out in the title bar; ${others === 1 ? 'the other opens' : `the other ${others} open`} from +${others} beside it.`;
}

/**
 * The New project and Edit project sheet: the folder, a name, a logo (an image found in the folder,
 * any image, or the name's first letter on a color) and links, the starred one being the main link.
 */
export function ProjectSheet({ sheet }: { sheet: SheetState }) {
  const project = useApp((s) => (sheet.projectId === null ? null : (s.projects.find((other) => other.id === sheet.projectId) ?? null)));
  const home = useApp((s) => s.home);
  const closeSheet = useApp((s) => s.closeSheet);
  const removeProject = useApp((s) => s.removeProject);
  const editing = sheet.mode === 'edit';

  // The project as the sheet opened: what the form starts from.
  const [start] = useState(() => project);
  const [draft, setDraft] = useState(sheet.draft);
  const [name, setName] = useState(start?.name ?? sheet.draft.name);
  const [nameTouched, setNameTouched] = useState(false);
  const [chosen, setChosen] = useState<LogoCandidate[]>([]);
  const [pick, setPick] = useState<LogoPick>(() => {
    if (start) return start.logo.kind === 'image' ? { kind: 'keep' } : { kind: 'letter' };
    const first = sheet.draft.logos[0];
    return first ? { kind: 'candidate', id: first.id } : { kind: 'letter' };
  });
  const [color, setColor] = useState<LogoColor>(start?.logo.kind === 'letter' ? start.logo.color : colorFor(sheet.draft.dir));
  const [links, setLinks] = useState<LinkRow[]>(() => rowsOf(start?.links ?? sheet.draft.links));
  const [main, setMain] = useState(0);
  const [linksTouched, setLinksTouched] = useState(false);
  /** The row just added: its address field takes the focus. */
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameField.current?.focus();
    nameField.current?.select();
  }, []);

  // Esc closes the sheet; a Projects screen behind it stays.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSheet]);

  const tiles: Tile[] = [];
  if (start?.logo.kind === 'image' && start.logoUrl !== null) {
    tiles.push({ key: 'keep', pick: { kind: 'keep' }, label: 'Current', caption: { lead: 'The current logo.', path: '' }, url: start.logoUrl, aria: 'The current logo' });
  }
  for (const logo of draft.logos) {
    tiles.push({
      key: logo.id,
      pick: { kind: 'candidate', id: logo.id },
      label: fileName(logo.path),
      caption: { lead: 'Found in the folder:', path: logo.path },
      url: logo.url,
      aria: logo.path,
    });
  }
  for (const logo of chosen) {
    tiles.push({ key: logo.id, pick: { kind: 'candidate', id: logo.id }, label: fileName(logo.path), caption: { lead: 'Chosen:', path: logo.path }, url: logo.url, aria: logo.path });
  }
  tiles.push({ key: 'letter', pick: { kind: 'letter' }, label: 'Letter', caption: { lead: 'The first letter of the name, on the color picked.', path: '' }, url: null, aria: 'Letter' });
  const selected = tiles.find((tile) => samePick(tile.pick, pick)) ?? tiles.at(-1)!;

  // The open project stays in its folder; any other can move to another one.
  const canMove = !(editing && start?.open);

  const changeFolder = async () => {
    const next = await edi.chooseProjectFolder(sheet.projectId);
    if (next === null) return;
    setDraft(next);
    setError(null);
    if (!editing && !nameTouched) setName(next.name);
    if (!editing && !linksTouched) {
      setLinks(rowsOf(next.links));
      setMain(0);
    }
    // An image found in the old folder isn't offered any more: the new folder's first one, or what the project had.
    setPick((current) => {
      if (current.kind !== 'candidate' || chosen.some((logo) => logo.id === current.id)) return current;
      const first = next.logos[0];
      if (first) return { kind: 'candidate', id: first.id };
      return start?.logo.kind === 'image' ? { kind: 'keep' } : { kind: 'letter' };
    });
  };

  const chooseImage = async () => {
    const result = await edi.chooseLogo();
    if (result === null) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChosen((list) => [...list, result.logo]);
    setPick({ kind: 'candidate', id: result.logo.id });
    setError(null);
  };

  const editLink = (key: number, change: Partial<LinkRow>) => {
    setLinksTouched(true);
    setLinks((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };
  const addLink = () => {
    const key = ++rowKeys;
    setLinksTouched(true);
    setFocusRow(key);
    setLinks((rows) => [...rows, { key, url: '', label: '' }]);
  };
  const removeLink = (index: number) => {
    setLinksTouched(true);
    setLinks((rows) => rows.filter((_, other) => other !== index));
    setMain((current) => (current === index ? 0 : current > index ? current - 1 : current));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || draft.taken !== null) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('The project needs a name');
      nameField.current?.focus();
      return;
    }
    const filled = links.map((row, index) => ({ row, index })).filter(({ row }) => row.url.trim() !== '');
    const bad = filled.find(({ row }) => normalizeLink(row.url) === null);
    if (bad) {
      setError(`Not a web address: ${bad.row.url.trim()}`);
      return;
    }
    // The starred link goes first: the first one is the main link.
    const ordered = [...filled.filter(({ index }) => index === main), ...filled.filter(({ index }) => index !== main)];
    const chosenPick = selected.pick;
    const input: ProjectInput = {
      dir: draft.dir,
      name: trimmed,
      logo: chosenPick.kind === 'letter' ? { kind: 'letter', color } : chosenPick,
      links: ordered.map(({ row }) => ({ url: normalizeLink(row.url)!, label: row.label.trim() })),
    };
    setBusy(true);
    setError(null);
    const result = editing && sheet.projectId !== null ? await edi.updateProject(sheet.projectId, input) : await edi.createProject(input);
    setBusy(false);
    if (result.ok) {
      closeSheet();
      if (!editing) useApp.getState().showProjects(false);
    } else if (!result.cancelled) setError(result.error);
  };

  const remove = async () => {
    if (sheet.projectId !== null && (await removeProject(sheet.projectId))) closeSheet();
  };

  return (
    <div className="sheet-backdrop" data-testid="project-sheet">
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onSubmit={(event) => void submit(event)}>
        <h2 id="sheet-title" className="sheet-title">
          {editing ? 'Edit project' : 'New project'}
        </h2>

        <div className="sheet-body">
          <div className="sheet-field">
            <span className="sheet-label">FOLDER</span>
            <div className="sheet-folder">
              <FolderIcon size={15} />
              <span className="sheet-folder-path mono" title={draft.dir} data-testid="sheet-folder">
                {tildify(draft.dir, home)}
              </span>
              {canMove && (
                <button type="button" className="button-outline sheet-change" onClick={() => void changeFolder()}>
                  Change…
                </button>
              )}
            </div>
            {draft.taken !== null ? (
              <span className="sheet-note sheet-taken">This folder is already the project {draft.taken.name}.</span>
            ) : (
              <span className="sheet-note">
                {draft.repoCount === 0 ? 'No git repositories in it' : `${plural(draft.repoCount, 'git repository', 'git repositories')} found`}
              </span>
            )}
          </div>

          <div className="sheet-field">
            <label htmlFor="sheet-name" className="sheet-label">
              NAME
            </label>
            <input
              id="sheet-name"
              ref={nameField}
              className="sheet-input"
              value={name}
              maxLength={MAX_NAME}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
              }}
            />
          </div>

          <div className="sheet-field">
            <span className="sheet-label" id="sheet-logo">
              LOGO
            </span>
            <div className="logo-tiles" role="group" aria-labelledby="sheet-logo">
              {tiles.map((tile) => {
                const on = tile === selected;
                return (
                  <div key={tile.key} className="logo-tile">
                    <button
                      type="button"
                      className={`logo-tile-button${on ? ' on' : ''}`}
                      aria-pressed={on}
                      aria-label={tile.aria}
                      title={tile.aria}
                      onClick={() => setPick(tile.pick)}
                    >
                      {tile.url !== null ? <img src={tile.url} alt="" draggable={false} /> : <LetterLogo name={name} color={color} size={36} />}
                    </button>
                    <span className={`logo-tile-label${on ? ' on' : ''}`}>{tile.label}</span>
                  </div>
                );
              })}
              <div className="logo-tile">
                <button type="button" className="logo-tile-button choose" aria-label="Choose an image" title="Choose an image" onClick={() => void chooseImage()}>
                  <PlusIcon size={18} strokeWidth={1.4} />
                </button>
                <span className="logo-tile-label">Choose…</span>
              </div>
            </div>
            {selected.pick.kind === 'letter' && (
              <div className="logo-colors" role="group" aria-label="Color">
                <span className="sheet-note">Color</span>
                {LOGO_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`logo-swatch logo-color${option === color ? ' on' : ''}`}
                    data-color={option}
                    aria-label={COLOR_NAMES[option]}
                    aria-pressed={option === color}
                    title={COLOR_NAMES[option]}
                    onClick={() => setColor(option)}
                  />
                ))}
              </div>
            )}
            <span className="sheet-note" data-testid="logo-caption">
              {selected.caption.lead}
              {selected.caption.path !== '' && (
                <>
                  {' '}
                  <span className="mono sheet-note-path">{selected.caption.path}</span>
                </>
              )}
            </span>
          </div>

          <div className="sheet-field">
            <span className="sheet-label" id="sheet-links">
              LINKS <span className="sheet-label-optional">· optional</span>
            </span>
            {links.length > 0 && (
              <div className="link-rows" role="group" aria-labelledby="sheet-links">
                {links.map((row, index) => (
                  <div key={row.key} className={`link-row${invalidLink(row) ? ' invalid' : ''}`} data-testid="link-row">
                    <button
                      type="button"
                      className={`link-star${index === main ? ' on' : ''}`}
                      aria-pressed={index === main}
                      aria-label={index === main ? 'Main link' : `Make link ${index + 1} the main link`}
                      title={index === main ? 'Main link: written out in the title bar' : 'Make this the main link'}
                      onClick={() => setMain(index)}
                    >
                      <StarIcon size={14} filled={index === main} />
                    </button>
                    <input
                      className="link-url mono"
                      aria-label={`Link ${index + 1} address`}
                      aria-invalid={invalidLink(row)}
                      value={row.url}
                      placeholder="https://"
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus={row.key === focusRow}
                      onChange={(event) => editLink(row.key, { url: event.target.value })}
                    />
                    <input
                      className="link-label"
                      aria-label={`Link ${index + 1} label`}
                      value={row.label}
                      placeholder="Label"
                      maxLength={MAX_LABEL}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(event) => editLink(row.key, { label: event.target.value })}
                    />
                    <button type="button" className="link-remove" aria-label={`Remove link ${index + 1}`} title="Remove" onClick={() => removeLink(index)}>
                      <CloseIcon size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {links.length < MAX_LINKS && (
              <button type="button" className="link-add" onClick={addLink}>
                <PlusIcon size={12} strokeWidth={1.7} />
                <span>Add link</span>
              </button>
            )}
            <span className="sheet-note">{linksHelp(links)}</span>
          </div>

          {error !== null && (
            <p className="sheet-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="sheet-foot">
          {editing && (
            <button type="button" className="sheet-remove" onClick={() => void remove()}>
              Remove from list
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="sheet-cancel" onClick={closeSheet}>
            Cancel
          </button>
          <button type="submit" className="button-primary sheet-submit" disabled={busy || draft.taken !== null || name.trim() === ''}>
            {editing ? 'Save' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
