import { menuKeys } from '../components/keys';
import { ArchiveArrowDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { type Placement, placeMenu } from '../components/placeMenu';
import { usePopover } from '../components/usePopover';

export interface StashMenuProps {
  /** Files the repo lists: what "Stash all changes" takes (new files included). */
  total: number;
  /** Staged files: what "Stash staged changes" takes. */
  staged: number;
  /** Something is not staged (an unstaged change or a new file): only then is "staged" different from "all". */
  unstaged: boolean;
  /** A file is partly staged: git can't stash only its staged half reliably. */
  partlyStaged: boolean;
  /** An operation is running in the repo. */
  busy: boolean;
  /** The repo has conflicts: git can't stash then. */
  blocked: boolean;
  onStash(o: { message: string; staged: boolean }): void;
}

const MENU_SIZE = { width: 280, maxHeight: 220 };
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** The Stash button next to the commit button, and its menu: an optional message and what to stash. */
export function StashMenu({ total, staged, unstaged, partlyStaged, busy, blocked, onStash }: StashMenuProps) {
  const menu = usePopover<HTMLDivElement>();
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [message, setMessage] = useState('');

  // Fixed relative to the window, as the branch menu: the Git panel's scroll area can't clip it.
  useLayoutEffect(() => {
    if (!menu.open) {
      setPlace(null);
      return;
    }
    setMessage('');
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

  const stash = (stagedOnly: boolean) => {
    menu.setOpen(false);
    onStash({ message: message.trim(), staged: stagedOnly });
  };
  const disabled = busy || blocked;

  return (
    <div className="stash" ref={menu.ref} onKeyDown={menuKeys}>
      <button
        ref={button}
        className="stash-button"
        data-testid="stash-button"
        aria-label="Stash changes"
        title={blocked ? 'Resolve the conflicts first' : 'Stash changes'}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        disabled={disabled}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <ArchiveArrowDown size={14} strokeWidth={1.9} />
      </button>
      {menu.open && place && (
        <div className="menu stash-menu" role="menu" aria-label="Stash" style={place}>
          <input
            className="menu-input"
            placeholder="Message (optional)"
            aria-label="Stash message"
            autoFocus
            spellCheck={false}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                stash(false);
              }
            }}
          />
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" title="Staged and unstaged changes and new files" onClick={() => stash(false)}>
            <span className="menu-check">
              <ArchiveArrowDown size={12} strokeWidth={1.8} />
            </span>
            <span className="menu-item-text">Stash all changes</span>
            <span className="menu-item-hint">{files(total)}</span>
          </button>
          {staged > 0 && unstaged && (
            <button
              className="menu-item"
              role="menuitem"
              disabled={partlyStaged}
              title={partlyStaged ? 'Not while a file is partly staged: git cannot stash only its staged part' : 'Only what is staged; the rest stays'}
              onClick={() => stash(true)}
            >
              <span className="menu-check" />
              <span className="menu-item-text">Stash staged changes</span>
              <span className="menu-item-hint">{files(staged)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
