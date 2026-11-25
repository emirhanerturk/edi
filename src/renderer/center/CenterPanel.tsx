import type { RepoView } from '../../shared/api';
import { fileLetter } from '../git/model';
import { useApp } from '../store';
import { CenterTabs, type TabLabel } from './CenterTabs';
import { CommitView } from './CommitView';
import { DiffView } from './DiffView';
import { FileView } from './FileView';
import { StashView } from './StashView';
import { UntitledView } from './UntitledView';
import type { CenterTab } from './tabs';
import './center.css';

/** Center panel: tabs for open files and the active tab's view. Not rendered at all when closed. */
export function CenterPanel() {
  const center = useApp((s) => s.center);
  const repos = useApp((s) => s.workspace.repos);
  const unsaved = useApp((s) => s.unsaved);
  const { activateCenterTab, pinCenterTab, closeCenterTab, setCenterOpen, newUntitled } = useApp.getState();

  if (!center.open) return null;
  const labels: TabLabel[] = center.tabs.map((tab) => {
    if (tab.kind === 'commit') {
      const repo = repos.find((r) => r.path === tab.repoPath);
      return { id: tab.id, kind: tab.kind, name: tab.path.slice(0, 7), dir: repo?.name ?? '', letter: null, pinned: tab.pinned };
    }
    if (tab.kind === 'stash') {
      const repo = repos.find((r) => r.path === tab.repoPath);
      return { id: tab.id, kind: tab.kind, name: tab.label ?? 'Stash', dir: repo?.name ?? '', letter: null, pinned: tab.pinned };
    }
    if (tab.kind === 'untitled') {
      return { id: tab.id, kind: tab.kind, name: tab.path, dir: '', letter: null, pinned: true, unsaved: unsaved[tab.id] === true };
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
      unsaved: unsaved[tab.id] === true,
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
        onClose={(id) => void closeCenterTab(id)}
        onClosePanel={() => setCenterOpen(false)}
        onNew={newUntitled}
      />
      {active && <CenterView key={active.id} tab={active} repo={repos.find((repo) => repo.path === active.repoPath) ?? null} />}
    </section>
  );
}

function CenterView({ tab, repo }: { tab: CenterTab; repo: RepoView | null }) {
  if (tab.kind === 'untitled') return <UntitledView tab={tab} />;
  // If the repo disappeared, the tab closes on the next workspace event.
  if (!repo) return null;
  if (tab.kind === 'diff') return <DiffView repo={repo} path={tab.path} />;
  if (tab.kind === 'file') return <FileView repo={repo} path={tab.path} />;
  if (tab.kind === 'stash') return <StashView repo={repo} oid={tab.path} />;
  return <CommitView repo={repo} oid={tab.path} />;
}
