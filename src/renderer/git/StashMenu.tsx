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
  /** The commit box's text: the stash takes it as its message (git keeps one line of it). */
  message: string;
  onStash(o: { staged: boolean }): void;
}

const MENU_SIZE = { width: 280, maxHeight: 220 };
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** The commit box's text as git will keep it: one line. */
const oneLine = (message: string) => message.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** The Stash button next to the commit button, and its menu: what to stash, with the commit box's text as its message. */
export function StashMenu({ total, staged, unstaged, partlyStaged, busy, blocked, message, onStash }: StashMenuProps) {
  const menu = usePopover<HTMLDivElement>();
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const line = oneLine(message);

  // Fixed relative to the window, as the branch menu: the Git panel's scroll area can't clip it.
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

  const stash = (stagedOnly: boolean) => {
    menu.setOpen(false);
    onStash({ staged: stagedOnly });
  };
  const disabled = busy || blocked || total === 0;

  return (
    <div className="stash" ref={menu.ref} onKeyDown={menuKeys}>
      <button
        ref={button}
        className="stash-button"
        data-testid="stash-button"
        aria-label="Stash changes"
        title={blocked ? 'Resolve the conflicts first' : total === 0 ? 'Nothing to stash' : 'Stash changes'}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        disabled={disabled}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <ArchiveArrowDown size={14} strokeWidth={1.9} />
      </button>
      {menu.open && place && (
        <div className="menu stash-menu" role="menu" aria-label="Stash" style={place}>
          {/* The message comes from the commit box; without one git names the stash after the last commit. */}
          <div className={`stash-menu-message${line === '' ? ' is-empty' : ' mono'}`} data-testid="stash-menu-message" title={line || undefined}>
            {line === '' ? 'No message: type one in the commit box' : line}
          </div>
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" title="Staged and unstaged changes and new files" autoFocus onClick={() => stash(false)}>
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
