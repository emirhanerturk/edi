import { usePopover } from '../components/usePopover';
import type { ServerRow } from './model';
import './servers.css';

/** Counter of running servers in the status bar; clicking shows the list, clicking a row opens the address in the browser. */
export function ServersMenu({ rows, onOpen }: { rows: ServerRow[]; onOpen(url: string): void }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  if (rows.length === 0) return null;
  const label = `${rows.length} ${rows.length === 1 ? 'server' : 'servers'}`;
  return (
    <div className="servers" ref={ref}>
      <button className="servers-button" data-testid="servers" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        <span className="servers-dot">●</span> {label}
      </button>
      {open && (
        <div className="menu servers-menu" role="menu">
          {rows.map((row) => (
            <button
              key={`${row.tabId}:${row.port}`}
              className="menu-item servers-item"
              role="menuitem"
              title={`Open ${row.url}`}
              onClick={() => {
                setOpen(false);
                onOpen(row.url);
              }}
            >
              <span className="servers-address mono">localhost:{row.port}</span>
              {(row.repoName !== null || row.tabTitle !== null) && (
                <span className="servers-where">{[row.repoName, row.tabTitle].filter((part) => part !== null).join(' · ')}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
