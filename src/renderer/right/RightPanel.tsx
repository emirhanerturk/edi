import type { ReactNode } from 'react';
import { edi } from '../bridge';
import { BranchIcon, CollapseIcon, FetchIcon, FolderIcon, RescanIcon } from '../components/icons';
import { FilesPanel } from '../files/FilesPanel';
import { GitPanel } from '../git/GitPanel';
import { changeTotal } from '../git/model';
import { useApp } from '../store';

export type RightTab = 'git' | 'files';

export interface RightPanelViewProps {
  tab: RightTab;
  /** Git sekmesinin rozeti: değişen dosya sayısı. */
  badge: number;
  /** Remote'u olan en az bir repo var. */
  canFetch: boolean;
  onTab(tab: RightTab): void;
  onFetchAll(): void;
  onRescan(): void;
  onCollapseAll(): void;
  children: ReactNode;
}

/** Sağ panel: Git ve Files sekmeleri; başlıktaki düğmeler seçili sekmeye göre değişir. */
export function RightPanelView({ tab, badge, canFetch, onTab, onFetchAll, onRescan, onCollapseAll, children }: RightPanelViewProps) {
  return (
    <section className="git" aria-label={tab === 'git' ? 'Git' : 'Files'}>
      <div className="git-tabs">
        <div className="git-tablist" role="tablist" aria-label="Right panel">
          <button className={`git-tab${tab === 'git' ? ' active' : ''}`} role="tab" aria-selected={tab === 'git'} onClick={() => onTab('git')}>
            <BranchIcon size={14} strokeWidth={1.5} />
            <span>Git</span>
            {badge > 0 && (
              <span className="badge" data-testid="git-badge">
                {badge}
              </span>
            )}
          </button>
          <button className={`git-tab${tab === 'files' ? ' active' : ''}`} role="tab" aria-selected={tab === 'files'} onClick={() => onTab('files')}>
            <FolderIcon size={14} />
            <span>Files</span>
          </button>
        </div>
        <div className="spacer" />
        {tab === 'git' ? (
          <>
            <button className="icon-button" aria-label="Fetch all repositories" title="Fetch all repositories" disabled={!canFetch} onClick={onFetchAll}>
              <FetchIcon size={14} />
            </button>
            <button className="icon-button" aria-label="Rescan repositories" title="Rescan repositories" onClick={onRescan}>
              <RescanIcon size={14} />
            </button>
          </>
        ) : (
          <button className="icon-button" aria-label="Collapse all" title="Collapse all" onClick={onCollapseAll}>
            <CollapseIcon size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Sağ panelin uygulama durumuna bağlı hâli. */
export function RightPanel() {
  const tab = useApp((s) => s.rightTab);
  const repos = useApp((s) => s.workspace.repos);
  const { setRightTab, fetchAll, collapseFiles } = useApp.getState();
  return (
    <RightPanelView
      tab={tab}
      badge={changeTotal(repos)}
      canFetch={repos.some((repo) => repo.hasRemote)}
      onTab={setRightTab}
      onFetchAll={() => void fetchAll()}
      onRescan={() => void edi.rescan()}
      onCollapseAll={collapseFiles}
    >
      {tab === 'git' ? <GitPanel /> : <FilesPanel />}
    </RightPanelView>
  );
}
