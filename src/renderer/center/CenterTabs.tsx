import { CloseIcon, CommitIcon } from '../components/icons';
import { letterColor } from '../git/model';

/** How a tab looks in the bar. */
export interface TabLabel {
  id: string;
  kind: 'diff' | 'file' | 'commit';
  name: string;
  /** The file's folder; empty if at the root. */
  dir: string;
  /** Status letter (M, A, D, ?, U…); null if the file is unchanged. */
  letter: string | null;
  pinned: boolean;
}

export interface CenterTabsProps {
  tabs: TabLabel[];
  active: string | null;
  onActivate(id: string): void;
  onPin(id: string): void;
  onClose(id: string): void;
  onClosePanel(): void;
}

/** The center panel's tab bar. The button at the right end closes the panel; the tabs stay put. */
export function CenterTabs({ tabs, active, onActivate, onPin, onClose, onClosePanel }: CenterTabsProps) {
  return (
    <div className="tabbar center-tabbar">
      <div className="tabbar-tabs" role="tablist" aria-label="Open files">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          // Folder on the active tab; "diff" on a background diff tab, to tell it apart from the same file's content tab.
          const hint = isActive ? tab.dir : tab.kind === 'diff' ? 'diff' : '';
          return (
            <div
              key={tab.id}
              className={`tab center-tab${isActive ? ' active' : ''}`}
              data-testid="center-tab"
              data-preview={!tab.pinned}
              role="tab"
              aria-selected={isActive}
              tabIndex={-1}
              title={tab.dir ? `${tab.dir}/${tab.name}` : tab.name}
              onMouseDown={(event) => {
                // Middle click closes the tab.
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                } else if (event.button === 0) onActivate(tab.id);
              }}
              onDoubleClick={() => onPin(tab.id)}
            >
              {tab.kind === 'commit' && <CommitIcon size={13} className="tab-commit-icon" data-testid="commit-icon" />}
              {tab.letter !== null && (
                <span className="mono tab-letter" style={{ color: letterColor(tab.letter) }}>
                  {tab.letter}
                </span>
              )}
              <span className="tab-title">{tab.name}</span>
              {hint !== '' && <span className="tab-hint">{hint}</span>}
              {/* Takes up space on every tab; on an inactive tab it shows on hover (CSS). */}
              <button
                className="tab-close"
                data-reveal={isActive ? 'always' : 'hover'}
                aria-label="Close tab"
                title="Close tab"
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={() => onClose(tab.id)}
              >
                <CloseIcon size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="spacer" />
      <button className="tabbar-add" aria-label="Close panel" title="Close panel" onClick={onClosePanel}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
