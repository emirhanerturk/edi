import { Pencil } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Snippet } from '../../shared/api';
import { edi } from '../bridge';
import { ChevronDown, PlayIcon, PlusIcon, SearchIcon, SnippetIcon } from '../components/icons';
import { menuKeys } from '../components/keys';
import { type Placement, placeMenu } from '../components/placeMenu';
import { usePopover } from '../components/usePopover';
import { useApp } from '../store';
import './snippets.css';

const EMPTY: Snippet[] = [];
const MENU_SIZE = { width: 392, maxHeight: 560 };

/** The open project's snippets. */
export const useSnippets = () => useApp((s) => s.projects.find((project) => project.open)?.snippets ?? EMPTY);

/** Where a snippet runs, as the menu says it. */
export const whereLabel = (snippet: Snippet) => (snippet.where === '' ? 'project folder' : snippet.where);

/** The first line, and how many more there are. */
export function commandPreview(command: string): string {
  const lines = command.split('\n');
  const more = lines.length - 1;
  return `${lines[0]!.trim()}${more > 0 ? `   +${more} ${more === 1 ? 'line' : 'lines'}` : ''}`;
}

/**
 * The snippets that match the filter, by group: the ones without a group first, then the groups in the
 * order their first snippet was made.
 */
export function groupSnippets(snippets: Snippet[], filter: string): { group: string; snippets: Snippet[] }[] {
  const query = filter.trim().toLowerCase();
  const shown = snippets.filter((snippet) => query === '' || `${snippet.name} ${snippet.command} ${whereLabel(snippet)} ${snippet.group}`.toLowerCase().includes(query));
  const groups = [...new Set(shown.map((snippet) => snippet.group))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
  return groups.map((group) => ({ group, snippets: shown.filter((snippet) => snippet.group === group) }));
}

/** The button in the terminal tab bar and its menu: a click runs a snippet, ⌥-click types it. */
export function SnippetsMenu() {
  const snippets = useSnippets();
  const menu = usePopover<HTMLDivElement>();
  const [filter, setFilter] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupSnippets(snippets, filter), [snippets, filter]);
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  // Fixed relative to the window and kept inside it: a narrow terminal panel doesn't cut it off.
  useLayoutEffect(() => {
    if (!menu.open) {
      setPlace(null);
      return;
    }
    const update = () => {
      const anchor = button.current?.getBoundingClientRect();
      if (anchor) setPlace(placeMenu(anchor, { width: window.innerWidth, height: window.innerHeight }, MENU_SIZE));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [menu.open]);

  const open = (next: boolean) => {
    menu.setOpen(next);
    setFilter('');
    if (next) requestAnimationFrame(() => input.current?.focus());
  };
  const pick = (snippet: Snippet, typeOnly: boolean) => {
    open(false);
    const app = useApp.getState();
    if (typeOnly) app.typeSnippet(snippet);
    else void app.runSnippet(snippet);
  };
  const create = () => {
    open(false);
    useApp.getState().editSnippet(null);
  };
  return (
    <div className="snippets" ref={menu.ref} onKeyDown={menuKeys}>
      <button
        ref={button}
        className={`tabbar-add tabbar-snippets${menu.open ? ' open' : ''}`}
        data-testid="snippets-button"
        aria-label="Snippets"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title="Snippets"
        onClick={() => open(!menu.open)}
      >
        <SnippetIcon size={14} />
        <ChevronDown size={9} strokeWidth={2} />
      </button>
      {menu.open && place && (
        <div className="menu snippets-menu" role="menu" aria-label="Snippets" data-testid="snippets-menu" style={{ position: 'fixed', ...place }}>
          {snippets.length > 0 && (
            <label className="snippets-filter">
              <SearchIcon size={12} />
              <input
                ref={input}
                aria-label="Filter snippets"
                placeholder="Filter snippets"
                spellCheck={false}
                autoComplete="off"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  // Enter runs the first match.
                  const first = groups[0]?.snippets[0];
                  if (event.key === 'Enter' && first) pick(first, event.altKey);
                }}
              />
            </label>
          )}
          {snippets.length === 0 && <div className="snippets-empty">Save a command you run often, then run it from here with a click.</div>}
          <div className="snippets-list">
            {groups.map(({ group, snippets: items }) => (
              <div key={group} role="group" aria-label={group || 'Snippets'}>
                {group !== '' && <div className="menu-label">{group.toUpperCase()}</div>}
                {items.map((snippet) => (
                  <div key={snippet.id} className="snippet-row" data-testid="snippet-row">
                    <button
                      className="menu-item snippet-item"
                      role="menuitem"
                      title={snippet.command}
                      onClick={(event) => pick(snippet, event.altKey)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void edi.snippetMenu().then((action) => {
                          if (action === null) return;
                          open(false);
                          void useApp.getState().snippetAction(snippet, action);
                        });
                      }}
                    >
                      <span className="snippet-play">
                        <PlayIcon size={12} />
                      </span>
                      <span className="snippet-text">
                        <span className="snippet-name-line">
                          <span className="snippet-name">{snippet.name}</span>
                          {snippet.ask && <span className="snippet-ask">· asks first</span>}
                        </span>
                        <span className="snippet-command mono">{commandPreview(snippet.command)}</span>
                      </span>
                      <span className="snippet-where">{whereLabel(snippet)}</span>
                    </button>
                    <button
                      className="snippet-edit"
                      aria-label={`Edit ${snippet.name}`}
                      title="Edit snippet"
                      onClick={() => {
                        open(false);
                        useApp.getState().editSnippet(snippet);
                      }}
                    >
                      <Pencil size={12} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
            {snippets.length > 0 && groups.length === 0 && <div className="snippets-empty">No snippet matches “{filter.trim()}”.</div>}
          </div>
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" data-testid="new-snippet" onClick={create}>
            <span className="snippet-play">
              <PlusIcon size={12} />
            </span>
            <span className="menu-item-text">New snippet…</span>
          </button>
          <div className="snippets-hint">Click runs it in a new terminal tab. ⌥-click types it into the open terminal without running it.</div>
        </div>
      )}
    </div>
  );
}
