import { useEffect, useState } from 'react';
import type { BranchList } from '../../shared/api';
import { BranchIcon, CheckIcon, PlusIcon } from '../components/icons';
import { usePopover } from '../components/usePopover';

export interface BranchMenuProps {
  current: string;
  disabled?: boolean;
  load(): Promise<BranchList>;
  onSwitch(branch: string): void;
  onCreate(branch: string): void;
}

/** Branch düğmesi ve menüsü: yerel branch'ler ve "New branch…". */
export function BranchMenu({ current, disabled, load, onSwitch, onCreate }: BranchMenuProps) {
  const menu = usePopover<HTMLDivElement>();
  const [list, setList] = useState<BranchList | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

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
    // Menü her açılışta listeyi yeniden okur; `load` her çizimde yeni bir işlev olabilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open]);

  const pick = (action: () => void) => {
    menu.setOpen(false);
    action();
  };

  return (
    <div className="branch" ref={menu.ref}>
      <button
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
      {menu.open && (
        <div className="menu branch-menu" role="menu">
          {list === null && <div className="menu-label">Loading…</div>}
          {list && !list.ok && <div className="menu-label menu-error">{list.error}</div>}
          {list?.ok &&
            list.branches.map((branch) => (
              <button
                key={branch}
                className="menu-item mono"
                role="menuitem"
                onClick={() => pick(() => branch !== list.current && onSwitch(branch))}
              >
                <span className="menu-check">{branch === list.current && <CheckIcon size={12} />}</span>
                <span className="menu-item-text">{branch}</span>
              </button>
            ))}
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
