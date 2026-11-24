import { FilePlus, FolderPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { edi } from '../bridge';
import { BranchIcon, CollapseIcon, CommitIcon, FetchIcon, FolderIcon, RefreshIcon, RescanIcon } from '../components/icons';
import { HistoryPanel } from '../history/HistoryPanel';
import { FilesPanel } from '../files/FilesPanel';
import { GitPanel } from '../git/GitPanel';
import { changeTotal } from '../git/model';
import { useApp } from '../store';

export type RightTab = 'git' | 'history' | 'files';

export interface RightPanelViewProps {
  tab: RightTab;
  /** Badge on the Git tab: number of changed files. */
  badge: number;
  /** At least one repo has a remote. */
  canFetch: boolean;
  onTab(tab: RightTab): void;
  onFetchAll(): void;
  onRescan(): void;
  onCollapseAll(): void;
  onRefreshHistory(): void;
  /** Files tab, when the open folder is a single repo: a new file or folder at its root. */
  onNewEntry?(kind: 'file' | 'dir'): void;
  children: ReactNode;
}

/** Right panel: Git and Files tabs; the header buttons change with the selected tab. */
export function RightPanelView({ tab, badge, canFetch, onTab, onFetchAll, onRescan, onCollapseAll, onRefreshHistory, onNewEntry, children }: RightPanelViewProps) {
  return (
    <section className="git" aria-label={tab === 'git' ? 'Git' : tab === 'history' ? 'History' : 'Files'}>
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
          <button className={`git-tab${tab === 'history' ? ' active' : ''}`} role="tab" aria-selected={tab === 'history'} onClick={() => onTab('history')}>
            <CommitIcon size={14} />
            <span>History</span>
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
        ) : tab === 'history' ? (
          <button className="icon-button" aria-label="Refresh history" title="Refresh history" onClick={onRefreshHistory}>
            <RefreshIcon size={14} />
          </button>
        ) : (
          <>
            {onNewEntry && (
              <>
                <button className="icon-button" aria-label="New File" title="New File" onClick={() => onNewEntry('file')}>
                  <FilePlus size={14} strokeWidth={1.6} />
                </button>
                <button className="icon-button" aria-label="New Folder" title="New Folder" onClick={() => onNewEntry('dir')}>
                  <FolderPlus size={14} strokeWidth={1.6} />
                </button>
              </>
            )}
            <button className="icon-button" aria-label="Collapse all" title="Collapse all" onClick={onCollapseAll}>
              <CollapseIcon size={14} />
            </button>
          </>
        )}
      </div>
      {children}
    </section>
  );
}

/** The right panel bound to app state. */
export function RightPanel() {
  const tab = useApp((s) => s.rightTab);
  const repos = useApp((s) => s.workspace.repos);
  const dir = useApp((s) => s.workspace.dir);
  const { setRightTab, fetchAll, collapseFiles, refreshHistory, startFilesEdit } = useApp.getState();
  // With several repos, each repo row has its own buttons.
  const root = repos.length === 1 && repos[0]!.path === dir ? repos[0]!.path : null;
  return (
    <RightPanelView
      tab={tab}
      badge={changeTotal(repos)}
      canFetch={repos.some((repo) => repo.hasRemote)}
      onTab={setRightTab}
      onFetchAll={() => void fetchAll()}
      onRescan={() => void edi.rescan()}
      onCollapseAll={collapseFiles}
      onRefreshHistory={refreshHistory}
      onNewEntry={root === null ? undefined : (kind) => startFilesEdit({ mode: 'new', kind, repoPath: root, parent: '' })}
    >
      {tab === 'git' ? <GitPanel /> : tab === 'history' ? <HistoryPanel /> : <FilesPanel />}
    </RightPanelView>
  );
}
