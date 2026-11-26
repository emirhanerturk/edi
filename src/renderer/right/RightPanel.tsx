import { FilePlus, FolderPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { edi } from '../bridge';
import { BranchIcon, CollapseIcon, CommitIcon, FetchIcon, FolderIcon, RefreshIcon, RescanIcon, SearchIcon } from '../components/icons';
import { HistoryPanel } from '../history/HistoryPanel';
import { FilesPanel } from '../files/FilesPanel';
import { GitPanel } from '../git/GitPanel';
import { SearchPanel } from '../search/SearchPanel';
import { useSearch } from '../search/searchStore';
import { changeTotal } from '../git/model';
import { useApp } from '../store';

export type RightTab = 'git' | 'history' | 'files' | 'search';

const TAB_NAMES: Record<RightTab, string> = { git: 'Git', history: 'History', files: 'Files', search: 'Search' };

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
  /** The Search tab's buttons. */
  onSearchAgain?(): void;
  onCollapseResults?(): void;
  /** Files tab, when the open folder is a single repo: a new file or folder at its root. */
  onNewEntry?(kind: 'file' | 'dir'): void;
  children: ReactNode;
}

/** Right panel: Git, History, Files and Search tabs; the header buttons change with the selected tab. */
export function RightPanelView(props: RightPanelViewProps) {
  const { tab, badge, canFetch, onTab, onFetchAll, onRescan, onCollapseAll, onRefreshHistory, onSearchAgain, onCollapseResults, onNewEntry, children } = props;
  // In a narrow panel the tabs not open show only their icon: the name is in the tooltip.
  const tabButton = (id: RightTab, icon: ReactNode, extra?: ReactNode) => (
    <button
      className={`git-tab${tab === id ? ' active' : ''}`}
      role="tab"
      aria-selected={tab === id}
      aria-label={id === 'git' && badge > 0 ? `Git, ${badge} changed ${badge === 1 ? 'file' : 'files'}` : TAB_NAMES[id]}
      title={TAB_NAMES[id]}
      onClick={() => onTab(id)}
    >
      {icon}
      <span className="git-tab-label">{TAB_NAMES[id]}</span>
      {extra}
    </button>
  );
  return (
    <section className="git" aria-label={TAB_NAMES[tab]}>
      <div className="git-tabs">
        <div className="git-tablist" role="tablist" aria-label="Right panel">
          {tabButton(
            'git',
            <BranchIcon size={14} strokeWidth={1.5} />,
            badge > 0 && (
              <span className="badge" data-testid="git-badge">
                {badge}
              </span>
            ),
          )}
          {tabButton('history', <CommitIcon size={14} />)}
          {tabButton('files', <FolderIcon size={14} />)}
          {tabButton('search', <SearchIcon size={14} />)}
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
        ) : tab === 'search' ? (
          <>
            <button className="icon-button" aria-label="Search again" title="Search again" onClick={onSearchAgain}>
              <RefreshIcon size={14} />
            </button>
            <button className="icon-button" aria-label="Collapse all" title="Collapse all" onClick={onCollapseResults}>
              <CollapseIcon size={14} />
            </button>
          </>
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
      onSearchAgain={() => useSearch.getState().run()}
      onCollapseResults={() => useSearch.getState().collapseAll()}
      onNewEntry={root === null ? undefined : (kind) => startFilesEdit({ mode: 'new', kind, repoPath: root, parent: '' })}
    >
      {tab === 'git' ? <GitPanel /> : tab === 'history' ? <HistoryPanel /> : tab === 'files' ? <FilesPanel /> : <SearchPanel />}
    </RightPanelView>
  );
}
