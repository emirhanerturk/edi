import { fileLetter } from '../git/model';
import { useApp } from '../store';
import { CenterTabs, type TabLabel } from './CenterTabs';
import type { CenterTab } from './tabs';
import './center.css';

/** Orta panel: açık dosyaların sekmeleri ve etkin sekmenin görünümü. Kapalıyken hiç çizilmez. */
export function CenterPanel() {
  const center = useApp((s) => s.center);
  const repos = useApp((s) => s.workspace.repos);
  const { activateCenterTab, pinCenterTab, closeCenterTab, setCenterOpen } = useApp.getState();

  if (!center.open) return null;
  const labels: TabLabel[] = center.tabs.map((tab) => {
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
      {active && <CenterView key={active.id} tab={active} />}
    </section>
  );
}

function CenterView({ tab }: { tab: CenterTab }) {
  return (
    <div className="center-view" data-testid="center-view" data-kind={tab.kind}>
      <p className="center-note">{tab.path}</p>
    </div>
  );
}
