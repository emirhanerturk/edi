import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BranchIcon, ChevronDown, ClaudeMark, FolderIcon, PlusIcon } from '../components/icons';
import { menuKeys } from '../components/keys';
import { type Placement, placeMenu } from '../components/placeMenu';
import { tildify } from '../format';
import { useApp } from '../store';
import { type Place, tabPlaces } from './places';

const MENU_SIZE = { width: 344, maxHeight: 440 };

const TEXT = {
  shell: {
    label: 'OPEN A TERMINAL IN',
    keys: '⌘T',
    hint: '⌘T opens it in the project folder, ⌥⌘T opens this list. ↑↓ and ↵ pick from the keyboard.',
  },
  claude: {
    label: 'START CLAUDE CODE IN',
    keys: '⇧⌘T',
    hint: '⇧⌘T starts it in the project folder, ⌥⇧⌘T opens this list. ↑↓ and ↵ pick from the keyboard.',
  },
};

/**
 * + and ✳+ in the terminal tab bar open in the project folder; the ▾ beside each lists the project folder
 * and its repositories, to start the terminal or Claude Code session in one of them.
 */
export function NewTabButtons() {
  const kind = useApp((s) => s.placeMenu);
  const workspace = useApp((s) => s.workspace);
  const home = useApp((s) => s.home);
  const { newTab, showPlaceMenu } = useApp.getState();
  const places = useMemo(() => tabPlaces(workspace, tildify(workspace.dir ?? '', home)), [workspace, home]);
  // A project that is one repository has only its folder: nothing to choose.
  const choice = places.length > 1;
  const shellMore = useRef<HTMLButtonElement>(null);
  const claudeMore = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  // Fixed relative to the window, as the other menus, and kept inside it.
  useLayoutEffect(() => {
    if (kind === null) {
      setPlace(null);
      return;
    }
    const anchor = (kind === 'claude' ? claudeMore : shellMore).current?.getBoundingClientRect();
    if (anchor) setPlace(placeMenu(anchor, { width: window.innerWidth, height: window.innerHeight }, MENU_SIZE));
  }, [kind]);

  // Esc or a click elsewhere closes it; Esc gives the keyboard back to where it was (the terminal, after ⌥⌘T).
  useEffect(() => {
    if (kind === null) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || shellMore.current?.contains(target) || claudeMore.current?.contains(target)) return;
      showPlaceMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      showPlaceMenu(null);
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [kind, showPlaceMenu]);

  // The first place takes the keyboard: ↑↓ move, ↵ opens.
  useEffect(() => {
    if (kind !== null && place) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [kind, place]);

  // With only one place, nothing to choose: the menu doesn't open.
  useEffect(() => {
    if (kind !== null && !choice) showPlaceMenu(null);
  }, [kind, choice, showPlaceMenu]);

  const pick = (target: Place) => {
    const claude = kind === 'claude';
    showPlaceMenu(null);
    void newTab(target.repoPath === null ? { claude } : { claude, repoPath: target.repoPath });
  };

  return (
    <>
      <button className="tabbar-add" data-testid="new-terminal" aria-label="New terminal" title="New terminal (⌘T)" onClick={() => void newTab()}>
        <PlusIcon size={14} />
      </button>
      {choice && (
        <button
          ref={shellMore}
          className={`tabbar-more${kind === 'shell' ? ' open' : ''}`}
          data-testid="new-terminal-in"
          aria-label="New terminal in…"
          aria-haspopup="menu"
          aria-expanded={kind === 'shell'}
          title="New terminal in… (⌥⌘T)"
          onClick={() => showPlaceMenu(kind === 'shell' ? null : 'shell')}
        >
          <ChevronDown size={9} strokeWidth={2} />
        </button>
      )}
      <button
        className="tabbar-add tabbar-add-claude"
        data-testid="new-claude"
        aria-label="New Claude Code session"
        title="New Claude Code session (⇧⌘T)"
        onClick={() => void newTab({ claude: true })}
      >
        <ClaudeMark size={13} />
        <PlusIcon size={9} strokeWidth={2.4} />
      </button>
      {choice && (
        <button
          ref={claudeMore}
          className={`tabbar-more${kind === 'claude' ? ' open' : ''}`}
          data-testid="new-claude-in"
          aria-label="New Claude Code session in…"
          aria-haspopup="menu"
          aria-expanded={kind === 'claude'}
          title="New Claude Code session in… (⌥⇧⌘T)"
          onClick={() => showPlaceMenu(kind === 'claude' ? null : 'claude')}
        >
          <ChevronDown size={9} strokeWidth={2} />
        </button>
      )}
      {kind !== null && choice && place && (
        <div
          ref={menu}
          className="menu place-menu"
          role="menu"
          aria-label={kind === 'claude' ? 'Start Claude Code in' : 'Open a terminal in'}
          data-testid="place-menu"
          style={{ position: 'fixed', ...place }}
          onKeyDown={menuKeys}
        >
          <div className="menu-label">{TEXT[kind].label}</div>
          {places.map((target) => (
            <button
              key={target.repoPath ?? ''}
              className="menu-item place-item"
              role="menuitem"
              data-testid="place-item"
              title={target.repoPath ?? workspace.dir ?? ''}
              onClick={() => pick(target)}
            >
              <span className="place-icon">{target.repoPath === null ? <FolderIcon size={14} /> : <BranchIcon size={13} strokeWidth={1.5} />}</span>
              <span className="place-name">{target.name}</span>
              <span className="place-hint mono">{target.hint}</span>
              {kind === 'claude' && target.sessions > 0 && (
                <span className="place-sessions" title={`${target.sessions} Claude Code ${target.sessions === 1 ? 'session is' : 'sessions are'} open here`}>
                  <ClaudeMark size={11} />
                  {target.sessions}
                </span>
              )}
              {target.repoPath === null && <span className="menu-item-hint place-keys">{TEXT[kind].keys}</span>}
            </button>
          ))}
          <div className="menu-divider" />
          <div className="place-footer">{TEXT[kind].hint}</div>
        </div>
      )}
    </>
  );
}
