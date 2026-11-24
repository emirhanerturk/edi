import { edi } from '../bridge';
import { plural, tildify } from '../format';
import { useApp } from '../store';
import { ChevronRight, FolderIcon } from './icons';

/** Henüz klasör açılmamışken görünen ekran. */
export function EmptyState() {
  const home = useApp((s) => s.home);
  const recent = useApp((s) => s.recent);
  const openFolder = useApp((s) => s.openFolder);
  const openError = useApp((s) => s.openError);

  return (
    <main className="empty">
      <div className="empty-box">
        <div className="empty-head">
          <h1>Open a folder</h1>
          <p>Its git repositories show up in one list on the right. Terminals and Claude Code sessions open in that folder.</p>
        </div>

        <div className="empty-actions">
          <button className="button-primary button-large" onClick={() => void edi.chooseFolder()}>
            <FolderIcon size={15} />
            <span>Choose folder</span>
          </button>
          <span className="keycap mono">⌘O</span>
        </div>

        {openError && (
          <p className="empty-error" role="alert">
            {openError}
          </p>
        )}

        {recent.length > 0 && (
          <div className="empty-recent">
            <div className="section-label">RECENT</div>
            {recent.slice(0, 5).map((item) => (
              <button key={item.dir} className="recent-row" onClick={() => void openFolder(item.dir)}>
                <FolderIcon size={15} style={{ flex: 'none', color: 'var(--text-2)' }} />
                <span className="mono recent-path">{tildify(item.dir, home)}</span>
                <span className="recent-count">{plural(item.repoCount, 'repo', 'repos')}</span>
                <ChevronRight size={12} style={{ flex: 'none', color: 'var(--muted)' }} />
              </button>
            ))}
          </div>
        )}

        <div className="empty-hints">
          <span>
            <span className="mono">⌘T</span> new terminal
          </span>
          <span>
            <span className="mono">⌘1–9</span> switch tab
          </span>
          <span>
            <span className="mono">⌘↵</span> commit
          </span>
        </div>
      </div>
    </main>
  );
}
