import { edi } from '../bridge';
import { useApp } from '../store';
import { GitPanelView } from './GitPanelView';

/** Git sekmesinin uygulama durumuna bağlı hâli. */
export function GitPanel() {
  const repos = useApp((s) => s.workspace.repos);
  const expanded = useApp((s) => s.expanded);
  const toggleRepo = useApp((s) => s.toggleRepo);
  const newTab = useApp((s) => s.newTab);
  const drafts = useApp((s) => s.drafts);
  const errors = useApp((s) => s.errors);
  const setDraft = useApp((s) => s.setDraft);
  const gitOp = useApp((s) => s.gitOp);
  const dismissError = useApp((s) => s.dismissError);
  const fetchAll = useApp((s) => s.fetchAll);

  return (
    <GitPanelView
      repos={repos}
      expanded={expanded}
      onToggle={toggleRepo}
      onRescan={() => void edi.rescan()}
      onOpenTerminal={(repoPath) => void newTab({ repoPath })}
      drafts={drafts}
      errors={errors}
      onDraft={setDraft}
      onOp={(repoPath, op) => void gitOp(repoPath, op)}
      onDismissError={dismissError}
      onFetchAll={() => void fetchAll()}
      loadBranches={(repoPath) => edi.branches(repoPath)}
    />
  );
}
