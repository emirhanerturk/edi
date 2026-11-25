import { tabKeys } from '../components/keys';
import { Archive } from 'lucide-react';
import { CloseIcon, CommitIcon, PlusIcon } from '../components/icons';
import { letterColor } from '../git/model';

/** How a tab looks in the bar. */
export interface TabLabel {
  id: string;
  kind: 'diff' | 'file' | 'commit' | 'stash' | 'untitled';
  name: string;
  /** The file's folder; empty if at the root. */
  dir: string;
  /** Status letter (M, A, D, ?, U…); null if the file is unchanged. */
  letter: string | null;
  pinned: boolean;
  /** A file tab with unsaved edits. */
  unsaved?: boolean;
}

export interface CenterTabsProps {
  tabs: TabLabel[];
  active: string | null;
  onActivate(id: string): void;
  onPin(id: string): void;
  onClose(id: string): void;
  onClosePanel(): void;
  /** The + button, or a double click on the empty part of the bar: a new untitled file. */
  onNew?(): void;
}

/** The center panel's tab bar. The button at the right end closes the panel; the tabs stay put. */
export function CenterTabs({ tabs, active, onActivate, onPin, onClose, onClosePanel, onNew }: CenterTabsProps) {
  return (
    <div
      className="tabbar center-tabbar"
      onDoubleClick={(event) => {
        // Only the empty part: not a tab or a button.
        if (!(event.target as HTMLElement).closest('.center-tab, button')) onNew?.();
      }}
    >
      <div
        className="tabbar-tabs"
        role="tablist"
        aria-label="Open files"
        onKeyDown={(event) =>
          tabKeys(
            event,
            tabs.map((tab) => tab.id),
            onActivate,
          )
        }
      >
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
              data-unsaved={tab.unsaved ? 'true' : undefined}
              role="tab"
              aria-selected={isActive}
              // The active tab is the one Tab reaches; the arrow keys move between tabs.
              tabIndex={isActive ? 0 : -1}
              title={(tab.dir ? `${tab.dir}/${tab.name}` : tab.name) + (tab.unsaved ? ' · unsaved changes' : '')}
              onMouseDown={(event) => {
                // Middle click closes the tab.
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                } else if (event.button === 0) onActivate(tab.id);
              }}
              onDoubleClick={() => onPin(tab.id)}
              onKeyDown={(event) => {
                // Enter keeps the tab, as a double click does.
                if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
                event.preventDefault();
                onPin(tab.id);
              }}
            >
              {tab.kind === 'commit' && <CommitIcon size={13} className="tab-commit-icon" data-testid="commit-icon" />}
              {tab.kind === 'stash' && <Archive size={13} strokeWidth={1.7} className="tab-commit-icon" data-testid="stash-icon" aria-hidden="true" />}
              {tab.letter !== null && (
                <span className="mono tab-letter" style={{ color: letterColor(tab.letter) }}>
                  {tab.letter}
                </span>
              )}
              <span className="tab-title">{tab.name}</span>
              {hint !== '' && <span className="tab-hint">{hint}</span>}
              {/* Takes up space on every tab; on an inactive tab it shows on hover (CSS). With unsaved
                  edits it always shows, as a dot that turns into the close icon on hover. */}
              <button
                className="tab-close"
                data-reveal={isActive || tab.unsaved ? 'always' : 'hover'}
                aria-label={tab.unsaved ? 'Close tab (unsaved changes)' : 'Close tab'}
                title={tab.unsaved ? 'Close tab (unsaved changes)' : 'Close tab'}
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={() => onClose(tab.id)}
              >
                {tab.unsaved && <span className="tab-dot" aria-hidden="true" />}
                <CloseIcon size={11} />
              </button>
            </div>
          );
        })}
      </div>
      {onNew && (
        <button className="tabbar-add" data-testid="new-untitled" aria-label="New file" title="New file (⌘N)" onClick={onNew}>
          <PlusIcon size={14} />
        </button>
      )}
      <div className="spacer" />
      <button className="tabbar-add" aria-label="Close panel" title="Close panel" onClick={onClosePanel}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
