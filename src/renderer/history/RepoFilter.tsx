import { menuKeys } from '../components/keys';
import { ChevronDown } from '../components/icons';
import { usePopover } from '../components/usePopover';

export interface RepoFilterProps {
  repos: { name: string; path: string }[];
  /** Path of the selected repo; null for all. */
  filter: string | null;
  onFilter(path: string | null): void;
}

const ALL = 'All repositories';

/** Menu that filters History to a single repo. */
export function RepoFilter({ repos, filter, onFilter }: RepoFilterProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const current = repos.find((repo) => repo.path === filter) ?? null;
  const pick = (path: string | null) => {
    setOpen(false);
    onFilter(path);
  };
  return (
    <div className="history-filter" ref={ref} onKeyDown={menuKeys}>
      <button
        className={`history-filter-button${current ? ' filtered' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current?.name ?? ALL}
        onClick={() => setOpen(!open)}
      >
        <span className="history-filter-name">{current?.name ?? ALL}</span>
        <ChevronDown size={10} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="menu history-filter-menu" role="menu">
          <button className="menu-item" role="menuitemradio" aria-checked={current === null} onClick={() => pick(null)}>
            {ALL}
          </button>
          <div className="menu-divider" />
          {repos.map((repo) => (
            <button key={repo.path} className="menu-item" role="menuitemradio" aria-checked={repo.path === current?.path} onClick={() => pick(repo.path)}>
              {repo.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
