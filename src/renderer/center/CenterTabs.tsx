import { CloseIcon } from '../components/icons';
import { letterColor } from '../git/model';

/** Bir sekmenin çubukta görünen hâli. */
export interface TabLabel {
  id: string;
  kind: 'diff' | 'file' | 'commit';
  name: string;
  /** Dosyanın klasörü; kökteyse boş. */
  dir: string;
  /** Durum harfi (M, A, D, ?, U…); dosya değişmemişse null. */
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

/** Orta panelin sekme çubuğu. Sağ uçtaki düğme paneli kapatır; sekmeler yerinde kalır. */
export function CenterTabs({ tabs, active, onActivate, onPin, onClose, onClosePanel }: CenterTabsProps) {
  return (
    <div className="tabbar center-tabbar">
      <div className="tabbar-tabs" role="tablist" aria-label="Open files">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          // Etkin sekmede klasör; arka plandaki diff sekmesi, aynı dosyanın içerik sekmesinden ayırt edilsin diye "diff".
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
                // Orta tuş sekmeyi kapatır.
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                } else if (event.button === 0) onActivate(tab.id);
              }}
              onDoubleClick={() => onPin(tab.id)}
            >
              {tab.letter !== null && (
                <span className="mono tab-letter" style={{ color: letterColor(tab.letter) }}>
                  {tab.letter}
                </span>
              )}
              <span className="tab-title">{tab.name}</span>
              {hint !== '' && <span className="tab-hint">{hint}</span>}
              {isActive && (
                <button
                  className="tab-close"
                  aria-label="Close tab"
                  title="Close tab"
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={() => onClose(tab.id)}
                >
                  <CloseIcon size={11} />
                </button>
              )}
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
