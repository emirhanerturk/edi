import { menuKeys } from '../components/keys';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BranchInfo, BranchList } from '../../shared/api';
import { BranchIcon, CheckIcon, PlusIcon } from '../components/icons';
import { age } from '../format';
import { type Placement, placeMenu } from '../components/placeMenu';
import { usePopover } from '../components/usePopover';

export interface BranchMenuProps {
  /** The branch's name; on a detached HEAD, the commit's short id. */
  current: string;
  /** The button's tooltip; defaults to `current`. */
  title?: string;
  disabled?: boolean;
  load(): Promise<BranchList>;
  onSwitch(branch: string): void;
  onCreate(branch: string): void;
}

/** The menu can be wider than the panel so long branch names (claude/…) fit without truncation. */
const MENU_SIZE = { width: 500, maxHeight: 420 };

/** The current branch on top, the rest as listed (most recently committed to first). */
function currentFirst(branches: BranchInfo[], current: string | null): BranchInfo[] {
  const top = branches.filter((branch) => branch.name === current);
  return [...top, ...branches.filter((branch) => branch.name !== current)];
}

function branchTitle(branch: BranchInfo, now: number): string {
  const counts = [branch.ahead > 0 && `${branch.ahead} to push`, branch.behind > 0 && `${branch.behind} to pull`].filter(Boolean);
  return [branch.name, ...counts, `last commit ${age(branch.updatedAt, now)}`].join(' · ');
}

/** Branch button and its menu: local branches and "New branch…". */
export function BranchMenu({ current, title, disabled, load, onSwitch, onCreate }: BranchMenuProps) {
  const menu = usePopover<HTMLDivElement>();
  const [list, setList] = useState<BranchList | null>(null);
  // The time the list was read: the ages are relative to it.
  const [readAt, setReadAt] = useState(0);
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
      if (stale) return;
      setReadAt(Date.now());
      setList(result);
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
    <div className="branch" ref={menu.ref} onKeyDown={menuKeys}>
      <button
        ref={button}
        className="branch-chip mono"
        data-testid="branch-button"
        title={title ?? current}
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
              currentFirst(list.branches, list.current).map((branch) => (
                <button
                  key={branch.name}
                  className="menu-item mono branch-item"
                  data-current={branch.name === list.current}
                  role="menuitem"
                  title={branchTitle(branch, readAt)}
                  onClick={() => pick(() => branch.name !== list.current && onSwitch(branch.name))}
                >
                  <span className="menu-check">{branch.name === list.current && <CheckIcon size={12} />}</span>
                  <span className="menu-item-text">{branch.name}</span>
                  {branch.ahead > 0 && <span className="branch-ahead">↑{branch.ahead}</span>}
                  {branch.behind > 0 && <span className="branch-behind">↓{branch.behind}</span>}
                  <span className="branch-age">{age(branch.updatedAt, readAt)}</span>
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
