import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BranchList } from '../../shared/api';
import { BranchIcon, CheckIcon, PlusIcon } from '../components/icons';
import { type Placement, placeMenu } from '../components/placeMenu';
import { usePopover } from '../components/usePopover';

export interface BranchMenuProps {
  current: string;
  disabled?: boolean;
  load(): Promise<BranchList>;
  onSwitch(branch: string): void;
  onCreate(branch: string): void;
}

/** The menu can be wider than the panel so long branch names (claude/…) fit without truncation. */
const MENU_SIZE = { width: 440, maxHeight: 420 };

/** Branch button and its menu: local branches and "New branch…". */
export function BranchMenu({ current, disabled, load, onSwitch, onCreate }: BranchMenuProps) {
  const menu = usePopover<HTMLDivElement>();
  const [list, setList] = useState<BranchList | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  // The menu is fixed relative to the window: the Git panel's scroll area can't clip it.
  useLayoutEffect(() => {
    if (!menu.open) {
      setPlace(null);
      return;
    }
    const update = () => {
      const anchor = button.current?.getBoundingClientRect();
      if (anchor) setPlace(placeMenu(anchor, { width: window.innerWidth, height: window.innerHeight }, MENU_SIZE));
    };
    // If the repo list scrolls, the button moves; the menu closes so it isn't left floating.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.ref.current?.contains(event.target)) menu.setOpen(false);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open]);

  useEffect(() => {
    if (!menu.open) return;
    let stale = false;
    setList(null);
    setCreating(false);
    setName('');
    void load().then((result) => {
      if (!stale) setList(result);
    });
    return () => {
      stale = true;
    };
    // The menu rereads the list on every open; `load` may be a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open]);

  const pick = (action: () => void) => {
    menu.setOpen(false);
    action();
  };

  return (
    <div className="branch" ref={menu.ref}>
      <button
        ref={button}
        className="branch-chip mono"
        data-testid="branch-button"
        title={current}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        disabled={disabled}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <BranchIcon size={11} />
        <span className="branch-name">{current}</span>
      </button>
      {menu.open && place && (
        <div className="menu branch-menu" role="menu" style={place}>
          <div className="branch-list">
            {list === null && <div className="menu-label">Loading…</div>}
            {list && !list.ok && <div className="menu-label menu-error">{list.error}</div>}
            {list?.ok &&
              list.branches.map((branch) => (
                <button
                  key={branch}
                  className="menu-item mono"
                  role="menuitem"
                  title={branch}
                  onClick={() => pick(() => branch !== list.current && onSwitch(branch))}
                >
                  <span className="menu-check">{branch === list.current && <CheckIcon size={12} />}</span>
                  <span className="menu-item-text">{branch}</span>
                </button>
              ))}
          </div>
          <div className="menu-divider" />
          {creating ? (
            <input
              className="menu-input mono"
              placeholder="Branch name"
              aria-label="New branch name"
              autoFocus
              spellCheck={false}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim() !== '') pick(() => onCreate(name.trim()));
              }}
            />
          ) : (
            <button className="menu-item" role="menuitem" onClick={() => setCreating(true)}>
              <span className="menu-check">
                <PlusIcon size={12} />
              </span>
              <span className="menu-item-text">New branch…</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
