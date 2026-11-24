import { edi } from '../bridge';
import { useApp } from '../store';
import { GitPanelView } from './GitPanelView';

/** The Git tab bound to app state. */
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
  const openInCenter = useApp((s) => s.openInCenter);
  const center = useApp((s) => s.center);
  const active = center.open ? (center.tabs.find((tab) => tab.id === center.active) ?? null) : null;

  return (
    <GitPanelView
      repos={repos}
      expanded={expanded}
      onToggle={toggleRepo}
      onOpenTerminal={(repoPath) => void newTab({ repoPath })}
      drafts={drafts}
      errors={errors}
      onDraft={setDraft}
      onOp={(repoPath, op) => void gitOp(repoPath, op)}
      onDismissError={dismissError}
      onOpenInZed={(repoPath, path) => void useApp.getState().openInZed(repoPath, path)}
      loadBranches={(repoPath) => edi.branches(repoPath)}
      // A new file has no old version to compare against: its content opens in the file view.
      onOpenFile={(repoPath, file, pin) => openInCenter({ kind: file.kind === 'untracked' ? 'file' : 'diff', repoPath, path: file.path }, pin)}
      selected={active && { repoPath: active.repoPath, path: active.path }}
    />
  );
}
