import { edi } from '../bridge';
import { useApp } from '../store';
import { GitPanelView } from './GitPanelView';
import { stashTitle } from './model';

/** Stable, so the Unpushed and Incoming sections read only when HEAD or the count moves. */
const loadUnpushed = (repoPath: string) => edi.unpushed(repoPath);
const loadIncoming = (repoPath: string) => edi.incoming(repoPath);
/** Stable, so the Stashes section reads only when the count moves. */
const loadStashes = (repoPath: string) => edi.stashes(repoPath);
const stashMenu = (canApply: boolean) => edi.stashMenu(canApply);

/** The Git tab bound to app state. */
export function GitPanel() {
  const repos = useApp((s) => s.workspace.repos);
  const dir = useApp((s) => s.workspace.dir);
  const retries = useApp((s) => s.retries);
  const stashAction = useApp((s) => s.stashAction);
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
      selected={active && { repoPath: active.repoPath, path: active.path, kind: active.kind }}
      loadUnpushed={loadUnpushed}
      loadIncoming={loadIncoming}
      onOpenCommit={(repoPath, oid, pin) => openInCenter({ kind: 'commit', repoPath, path: oid }, pin)}
      onUndoCommit={(repoPath, commit) => {
        void edi.confirmUndo(commit.subject).then((yes) => {
          if (yes) void gitOp(repoPath, { op: 'undoCommit', oid: commit.oid });
        });
      }}
      // The open folder is itself the one repo (as in the Files tab).
      single={repos.length === 1 && repos[0]!.path === dir}
      loadStashes={loadStashes}
      onOpenStash={(repoPath, stash, pin) => openInCenter({ kind: 'stash', repoPath, path: stash.oid, label: stashTitle(stash) }, pin)}
      onStashAction={(repoPath, stash, action) => void stashAction(repoPath, stash, action)}
      stashMenu={stashMenu}
      retries={retries}
    />
  );
}
