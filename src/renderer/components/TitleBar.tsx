import { edi } from '../bridge';
import { plural, tildify } from '../format';
import { useApp } from '../store';
import { ChevronDown, ClaudeMark, FolderIcon } from './icons';
import { usePopover } from './usePopover';

export function TitleBar() {
  const home = useApp((s) => s.home);
  const workspace = useApp((s) => s.workspace);
  const sessions = workspace.rootSessions + workspace.repos.reduce((sum, repo) => sum + repo.claude, 0);

  return (
    <header className="titlebar" data-testid="titlebar">
      <span className="titlebar-name">edi</span>
      <div className="titlebar-center">{workspace.dir !== null && <FolderMenu dir={workspace.dir} home={home} />}</div>
      {sessions > 0 && (
        <div className="titlebar-sessions" title="Claude Code sessions running in a terminal under this folder">
          <ClaudeMark size={13} label="Claude Code" />
          <span>{plural(sessions, 'session', 'sessions')}</span>
        </div>
      )}
    </header>
  );
}

function FolderMenu({ dir, home }: { dir: string; home: string }) {
  const recent = useApp((s) => s.recent);
  const openFolder = useApp((s) => s.openFolder);
  const { open, setOpen, ref: root } = usePopover<HTMLDivElement>();

  const others = recent.filter((item) => item.dir !== dir);
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="folder" ref={root}>
      <button
        className="folder-button mono"
        data-testid="folder-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <FolderIcon size={13} />
        <span className="folder-path">{tildify(dir, home)}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="menu folder-menu" role="menu" data-testid="folder-menu">
          {others.length > 0 && <div className="menu-label">RECENT</div>}
          {others.map((item) => (
            <button key={item.dir} className="menu-item" role="menuitem" onClick={() => pick(() => void openFolder(item.dir))}>
              <FolderIcon size={13} />
              <span className="mono menu-item-text">{tildify(item.dir, home)}</span>
              <span className="menu-item-hint">{plural(item.repoCount, 'repo', 'repos')}</span>
            </button>
          ))}
          {others.length > 0 && <div className="menu-divider" />}
          <button className="menu-item" role="menuitem" onClick={() => pick(() => void edi.chooseFolder())}>
            <span className="menu-item-text">Choose folder…</span>
            <span className="menu-item-hint mono">⌘O</span>
          </button>
        </div>
      )}
    </div>
  );
}
