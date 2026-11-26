import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Snippet } from '../../shared/api';
import { edi } from '../bridge';
import { CheckIcon, ChevronDown, FolderIcon, PlusIcon } from '../components/icons';
import { menuKeys } from '../components/keys';
import { usePopover } from '../components/usePopover';
import { tildify } from '../format';
import { useApp } from '../store';
import { useSnippets } from './SnippetsMenu';
import './snippets.css';

/** The groups the project's snippets have, in the order the menu lists them. */
export const groupsOf = (snippets: Snippet[]) => [...new Set(snippets.map((snippet) => snippet.group).filter((group) => group !== ''))];

/** The places a snippet can run: the project folder, then each repository (not the folder itself when it is the only one). */
function usePlaces() {
  const dir = useApp((s) => s.workspace.dir);
  const repos = useApp((s) => s.workspace.repos);
  return useMemo(
    () => [{ where: '', name: 'Project folder', path: dir ?? '' }, ...repos.filter((repo) => repo.path !== dir).map((repo) => ({ where: repo.name, name: repo.name, path: repo.path }))],
    [dir, repos],
  );
}

/** RUNS IN: a button that opens the list of places. */
function PlacePicker({ where, onPick }: { where: string; onPick(where: string): void }) {
  const places = usePlaces();
  const home = useApp((s) => s.home);
  const menu = usePopover<HTMLDivElement>();
  const current = places.find((place) => place.where === where) ?? { where, name: where, path: '' };
  return (
    <div
      className="snippet-place"
      ref={menu.ref}
      onKeyDown={(event) => {
        // Esc closes the list, not the whole sheet.
        if (event.key === 'Escape' && menu.open) event.preventDefault();
        menuKeys(event);
      }}
    >
      <button type="button" className="snippet-place-button" aria-haspopup="menu" aria-expanded={menu.open} aria-label={`Runs in ${current.name}`} onClick={() => menu.setOpen(!menu.open)}>
        <FolderIcon size={14} />
        <span className="snippet-place-name">{current.name}</span>
        <span className="snippet-place-path mono">{current.path ? tildify(current.path, home) : 'not in the project any more'}</span>
        <ChevronDown size={12} />
      </button>
      {menu.open && (
        <div className="menu snippet-place-menu" role="menu">
          {places.map((place) => (
            <button
              key={place.where}
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                menu.setOpen(false);
                onPick(place.where);
              }}
            >
              <span className="menu-check">{place.where === where && <CheckIcon size={12} />}</span>
              <span className="menu-item-text">{place.name}</span>
              <span className="menu-item-hint mono">{tildify(place.path, home)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** New snippet / Edit snippet: a name, a group, where it runs, the command and whether to ask first. */
export function SnippetSheet({ snippet }: { snippet: Snippet | null }) {
  const snippets = useSnippets();
  const projectName = useApp((s) => s.projects.find((project) => project.open)?.name ?? 'open');
  const close = useApp((s) => s.closeSnippetSheet);
  const [name, setName] = useState(snippet?.name ?? '');
  const [group, setGroup] = useState(snippet?.group ?? '');
  const [where, setWhere] = useState(snippet?.where ?? '');
  const [command, setCommand] = useState(snippet?.command ?? '');
  const [ask, setAsk] = useState(snippet?.ask ?? false);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const groups = useMemo(() => {
    const known = groupsOf(snippets);
    return group !== '' && !known.includes(group) ? [...known, group] : known;
  }, [snippets, group]);

  useEffect(() => {
    nameField.current?.focus();
    nameField.current?.select();
  }, []);

  // Esc closes the sheet (a field's own Esc, such as the new group's, comes first).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await edi.saveSnippet({ ...(snippet ? { id: snippet.id } : {}), name, group, where, command, ask });
    setBusy(false);
    if (result.ok) close();
    else setError(result.error);
  };

  const finishGroup = () => {
    const typed = (newGroup ?? '').replace(/\s+/g, ' ').trim();
    if (typed !== '') setGroup(typed);
    setNewGroup(null);
  };

  return (
    <div className="sheet-backdrop" data-testid="snippet-sheet">
      <form ref={form} className="sheet" role="dialog" aria-modal="true" aria-labelledby="snippet-title" onSubmit={(event) => void submit(event)}>
        <h2 id="snippet-title" className="sheet-title">
          {snippet ? 'Edit snippet' : 'New snippet'}
        </h2>
        <div className="sheet-body">
          <div className="sheet-field">
            <label htmlFor="snippet-name" className="sheet-label">
              NAME
            </label>
            <input
              id="snippet-name"
              ref={nameField}
              className="sheet-input"
              value={name}
              maxLength={80}
              spellCheck={false}
              autoComplete="off"
              placeholder="Backend: dev server"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="sheet-field">
            <span className="sheet-label" id="snippet-group">
              GROUP <span className="sheet-label-optional">· optional</span>
            </span>
            <div className="snippet-groups" role="radiogroup" aria-labelledby="snippet-group">
              {groups.map((label) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={group === label}
                  className={`snippet-group${group === label ? ' on' : ''}`}
                  onClick={() => setGroup(group === label ? '' : label)}
                >
                  {group === label && <CheckIcon size={11} />}
                  <span>{label}</span>
                </button>
              ))}
              {newGroup === null ? (
                <button type="button" className="snippet-group new" onClick={() => setNewGroup('')}>
                  <PlusIcon size={11} />
                  <span>New group</span>
                </button>
              ) : (
                <input
                  className="snippet-group-input"
                  aria-label="New group name"
                  autoFocus
                  maxLength={40}
                  spellCheck={false}
                  value={newGroup}
                  onChange={(event) => setNewGroup(event.target.value)}
                  onBlur={finishGroup}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      finishGroup();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setNewGroup(null);
                    }
                  }}
                />
              )}
            </div>
            <span className="sheet-note">The menu lists a group's snippets under its name; snippets without one come first.</span>
          </div>

          <div className="sheet-field">
            <span className="sheet-label">RUNS IN</span>
            <PlacePicker where={where} onPick={setWhere} />
            <span className="sheet-note">The project folder or one of its repositories.</span>
          </div>

          <div className="sheet-field">
            <label htmlFor="snippet-command" className="sheet-label">
              COMMAND
            </label>
            <textarea
              id="snippet-command"
              className="snippet-command-field mono"
              rows={4}
              spellCheck={false}
              value={command}
              placeholder="npm run dev"
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.metaKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <span className="sheet-note">Runs in a new terminal tab named after the snippet, line by line, as if you typed it there.</span>
          </div>

          <label className="snippet-ask-field">
            <input type="checkbox" checked={ask} onChange={(event) => setAsk(event.target.checked)} />
            <span className="snippet-check" aria-hidden="true">
              {ask && <CheckIcon size={11} strokeWidth={2.2} />}
            </span>
            <span className="snippet-ask-text">
              <span>Ask before running</span>
              <span className="sheet-note">For commands that deploy, publish or delete.</span>
            </span>
          </label>

          {error && (
            <p className="sheet-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="sheet-foot">
          <span className="sheet-note">Saved with the {projectName} project, not in a repository.</span>
          <div className="spacer" />
          <button type="button" className="sheet-cancel" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button-primary sheet-submit" disabled={busy || name.trim() === '' || command.trim() === ''}>
            {snippet ? 'Save' : 'Save snippet'}
          </button>
        </div>
      </form>
    </div>
  );
}
