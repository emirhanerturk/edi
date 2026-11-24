import type { RepoView } from '../../shared/api';
import { fileLetter } from '../git/model';
import { useApp } from '../store';
import { CenterTabs, type TabLabel } from './CenterTabs';
import { CommitView } from './CommitView';
import { DiffView } from './DiffView';
import { FileView } from './FileView';
import type { CenterTab } from './tabs';
import './center.css';

/** Center panel: tabs for open files and the active tab's view. Not rendered at all when closed. */
export function CenterPanel() {
  const center = useApp((s) => s.center);
  const repos = useApp((s) => s.workspace.repos);
  const { activateCenterTab, pinCenterTab, closeCenterTab, setCenterOpen } = useApp.getState();

  if (!center.open) return null;
  const labels: TabLabel[] = center.tabs.map((tab) => {
    if (tab.kind === 'commit') {
      const repo = repos.find((r) => r.path === tab.repoPath);
      return { id: tab.id, kind: tab.kind, name: tab.path.slice(0, 7), dir: repo?.name ?? '', letter: null, pinned: tab.pinned };
    }
    const slash = tab.path.lastIndexOf('/');
    const change = repos.find((repo) => repo.path === tab.repoPath)?.status?.files.find((file) => file.path === tab.path);
    return {
      id: tab.id,
      kind: tab.kind,
      name: tab.path.slice(slash + 1),
      dir: slash === -1 ? '' : tab.path.slice(0, slash),
      letter: change ? fileLetter(change) : null,
      pinned: tab.pinned,
    };
  });
  const active = center.tabs.find((tab) => tab.id === center.active) ?? null;

  return (
    <section className="center" aria-label="File and diff">
      <CenterTabs
        tabs={labels}
        active={center.active}
        onActivate={activateCenterTab}
        onPin={pinCenterTab}
        onClose={closeCenterTab}
        onClosePanel={() => setCenterOpen(false)}
      />
      {active && <CenterView key={active.id} tab={active} repo={repos.find((repo) => repo.path === active.repoPath) ?? null} />}
    </section>
  );
}

function CenterView({ tab, repo }: { tab: CenterTab; repo: RepoView | null }) {
  // If the repo disappeared, the tab closes on the next workspace event.
  if (!repo) return null;
  if (tab.kind === 'diff') return <DiffView repo={repo} path={tab.path} />;
  if (tab.kind === 'file') return <FileView repo={repo} path={tab.path} />;
  return <CommitView repo={repo} oid={tab.path} />;
}
