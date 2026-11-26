import { useApp } from '../store';

/**
 * The Git and Files tabs with no repo to show: the folder has none, or the project ignores every one
 * it has; then Edit project… opens the sheet where they can be ticked back.
 */
export function NoRepos({ ignored = 0, onEditProject }: { ignored?: number; onEditProject?(): void }) {
  if (ignored === 0) return <p className="git-empty">No git repositories in this folder</p>;
  return (
    <div className="git-empty no-repos">
      <p>{ignored === 1 ? 'The only repository is ignored' : `All ${ignored} repositories are ignored`}</p>
      {onEditProject && (
        <button type="button" className="button-outline" onClick={onEditProject}>
          Edit project…
        </button>
      )}
    </div>
  );
}

/** Edit project… for the open project; undefined when none is open. */
export function useEditOpenProject(): (() => void) | undefined {
  const id = useApp((s) => s.projects.find((project) => project.open)?.id);
  const startEditProject = useApp((s) => s.startEditProject);
  return id === undefined ? undefined : () => void startEditProject(id);
}
