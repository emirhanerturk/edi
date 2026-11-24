import { edi } from '../bridge';
import { useApp } from '../store';
import { GitPanelView } from './GitPanelView';

/** Git sekmesinin uygulama durumuna bağlı hâli. */
export function GitPanel() {
  const repos = useApp((s) => s.workspace.repos);
  const expanded = useApp((s) => s.expanded);
  const toggleRepo = useApp((s) => s.toggleRepo);
  const newTab = useApp((s) => s.newTab);

  return (
    <GitPanelView
      repos={repos}
      expanded={expanded}
      onToggle={toggleRepo}
      onRescan={() => void edi.rescan()}
      onOpenTerminal={(repoPath) => void newTab({ repoPath })}
    />
  );
}
