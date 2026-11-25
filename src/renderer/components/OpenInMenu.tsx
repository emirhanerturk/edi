import { type ReactNode, useEffect, useRef } from 'react';
import { EDITORS, type EditorId } from '../../shared/editors';
import { ExternalIcon } from './icons';
import { usePopover } from './usePopover';

/** How long the menu stays after the pointer leaves: crossing the gap to it doesn't close it. */
const LEAVE_MS = 150;

export interface OpenInMenuProps {
  onOpen(editor: EditorId): void;
  /** The button's look: the labelled "Open in…" button by default. */
  button?: (props: { open: boolean; toggle(): void }) => ReactNode;
  /** The class of the wrapper; places the menu. */
  className?: string;
}

/** "Open in…": the editors show under it on hover, and on a click or Enter for the keyboard. */
export function OpenInMenu({ onOpen, button, className = '' }: OpenInMenuProps) {
  const menu = usePopover<HTMLDivElement>();
  const leaving = useRef<number | null>(null);
  const stay = () => {
    if (leaving.current !== null) window.clearTimeout(leaving.current);
    leaving.current = null;
  };
  useEffect(() => stay, []);

  const toggle = () => menu.setOpen(!menu.open);
  return (
    <div
      className={`open-in ${className}`}
      ref={menu.ref}
      onMouseEnter={() => {
        stay();
        menu.setOpen(true);
      }}
      onMouseLeave={() => {
        stay();
        leaving.current = window.setTimeout(() => menu.setOpen(false), LEAVE_MS);
      }}
      // A click in the menu doesn't reach a row the menu sits on.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {button ? (
        button({ open: menu.open, toggle })
      ) : (
        <button className="view-button" aria-haspopup="menu" aria-expanded={menu.open} onClick={toggle}>
          <span>Open in…</span>
          <ExternalIcon size={12} />
        </button>
      )}
      {menu.open && (
        <div className="menu open-in-menu" role="menu">
          {EDITORS.map((editor) => (
            <button
              key={editor.id}
              className="menu-item"
              role="menuitem"
              onClick={() => {
                menu.setOpen(false);
                onOpen(editor.id);
              }}
            >
              <span className="menu-item-text">{editor.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
