import type { FileChange } from '../../git/types';
import type { RepoView } from '../../shared/api';
import {
  ArrowDown,
  ArrowUp,
  BranchIcon,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  ClaudeMark,
  MinusIcon,
  RescanIcon,
  Spinner,
  StageIcon,
  TerminalIcon,
  WarningIcon,
} from '../components/icons';
import {
  type Group,
  type SyncAction,
  changeCount,
  groupFiles,
  isDeletion,
  isExpanded,
  isPartlyStaged,
  letter,
  letterColor,
  splitPath,
  syncAction,
} from './model';

export interface GitPanelProps {
  repos: RepoView[];
  /** Kullanıcının elle açıp kapattığı repolar (yol → açık mı). */
  expanded: Record<string, boolean>;
  onToggle(repoPath: string, open: boolean): void;
  onRescan?(): void;
  onOpenTerminal?(repoPath: string): void;
}

/** Sağ panel, Git sekmesi: tüm repolar alt alta. */
export function GitPanelView(props: GitPanelProps) {
  const { repos } = props;
  const total = repos.reduce((sum, repo) => sum + (repo.status ? changeCount(repo.status) : 0), 0);

  return (
    <section className="git" aria-label="Git">
      <div className="git-tabs">
        <div className="git-tab active">
          <BranchIcon size={14} strokeWidth={1.5} />
          <span>Git</span>
          {total > 0 && (
            <span className="badge" data-testid="git-badge">
              {total}
            </span>
          )}
        </div>
        <div className="spacer" />
        <button className="icon-button" aria-label="Rescan repositories" title="Rescan repositories" onClick={props.onRescan}>
          <RescanIcon size={14} />
        </button>
      </div>

      <div className="git-list">
        {repos.length === 0 && <p className="git-empty">No git repositories in this folder</p>}
        {repos.map((repo) => (
          <Repo key={repo.path} repo={repo} {...props} />
        ))}
      </div>
    </section>
  );
}

function Repo({ repo, expanded, onToggle, onOpenTerminal }: GitPanelProps & { repo: RepoView }) {
  const { status } = repo;
  const open = isExpanded(status, expanded[repo.path]);

  if (!status) {
    return (
      <div className="repo" data-testid="repo-row" data-repo={repo.name} aria-expanded={false}>
        <div className="repo-head">
          <WarningIcon size={13} style={{ flex: 'none', color: 'var(--red)' }} />
          <span className="repo-name">{repo.name}</span>
          <span className="repo-error mono" title={repo.error ?? ''}>
            {repo.error ?? 'Reading…'}
          </span>
        </div>
      </div>
    );
  }

  const groups = groupFiles(status);
  const count = changeCount(status);
  const action = syncAction(status, repo.hasRemote);

  return (
    <div className={`repo${open ? ' open' : ''}`} data-testid="repo-row" data-repo={repo.name} aria-expanded={open}>
      <div className="repo-head">
        <button className="repo-toggle" data-testid="repo-toggle" onClick={() => onToggle(repo.path, !open)}>
          {open ? <ChevronDown size={11} strokeWidth={1.9} /> : <ChevronRight size={11} strokeWidth={1.9} />}
          <span className="repo-name">{repo.name}</span>
        </button>
        {repo.claude > 0 && <ClaudeMark size={12} label="Claude Code session open" />}
        {groups.conflicts.length > 0 && <span className="chip chip-warn">merging</span>}
        <div className="spacer" />

        {open ? (
          <>
            <span className="branch-chip mono" title={status.head}>
              <BranchIcon size={11} />
              <span className="branch-name">{status.head}</span>
            </span>
            {repo.busy ? <Busy label={repo.busy} /> : <SyncIcons ahead={status.ahead ?? 0} behind={status.behind ?? 0} hasRemote={repo.hasRemote} publish={action?.kind === 'publish'} />}
            <button
              className="icon-button small"
              aria-label="Open a terminal in this repository"
              title="Open a terminal in this repository"
              onClick={() => onOpenTerminal?.(repo.path)}
            >
              <TerminalIcon size={13} />
            </button>
          </>
        ) : (
          <>
            <span className="repo-branch mono" title={status.head}>
              {status.head}
            </span>
            {count === 0 ? (
              <CheckIcon size={13} label="Clean" style={{ flex: 'none', color: 'var(--green)' }} />
            ) : (
              <span className="repo-count" title={`${count} changed ${count === 1 ? 'file' : 'files'}`}>
                {count}
              </span>
            )}
            {repo.busy ? <Busy label={repo.busy} /> : <SyncButton action={action} />}
          </>
        )}
      </div>

      {open && (
        <div className="repo-body">
          {groups.conflicts.length > 0 && (
            <p className="repo-note">
              {groups.conflicts.length === 1 ? '1 file has conflicts. Resolve it' : `${groups.conflicts.length} files have conflicts. Resolve them`}{' '}
              in your editor, then stage {groups.conflicts.length === 1 ? 'it' : 'them'} from a terminal. edi does not mark
              conflicts as resolved.
            </p>
          )}
          <FileGroup title="CONFLICTS" group="conflicts" files={groups.conflicts} />
          <FileGroup title="STAGED" group="staged" files={groups.staged} />
          <FileGroup title="CHANGES" group="changes" files={groups.changes} />
          {count === 0 && <p className="repo-clean">No changes</p>}
        </div>
      )}
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <span className="repo-busy">
      <Spinner size={12} />
      <span>{label}</span>
    </span>
  );
}

function SyncButton({ action }: { action: SyncAction }) {
  if (!action) return null;
  return (
    <button className={`sync-button sync-${action.kind}`} data-testid="sync-button">
      {action.kind === 'pull' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
      <span>{action.label}</span>
    </button>
  );
}

/** Açık repo başlığındaki pull ve push düğmeleri; bekleyen commit varsa sayısıyla. */
function SyncIcons({ ahead, behind, hasRemote, publish }: { ahead: number; behind: number; hasRemote: boolean; publish: boolean }) {
  const pushTitle = !hasRemote ? 'No remote' : publish ? 'Publish branch' : ahead > 0 ? `Push ${ahead}` : 'Push';
  return (
    <>
      <button
        className={`icon-button small${behind > 0 ? ' has-pull' : ''}`}
        aria-label="Pull"
        title={!hasRemote ? 'No remote' : behind > 0 ? `Pull ${behind}` : 'Pull'}
        disabled={!hasRemote}
      >
        <ArrowDown size={13} strokeWidth={1.7} />
        {behind > 0 && <span className="icon-count">{behind}</span>}
      </button>
      <button className={`icon-button small${ahead > 0 || publish ? ' has-push' : ''}`} aria-label="Push" title={pushTitle} disabled={!hasRemote}>
        <ArrowUp size={13} strokeWidth={1.7} />
        {ahead > 0 && <span className="icon-count">{ahead}</span>}
      </button>
    </>
  );
}

function FileGroup({ title, group, files }: { title: string; group: Group; files: FileChange[] }) {
  if (files.length === 0) return null;
  return (
    <div className="file-group">
      <div className="file-group-head">
        <span>{title}</span>
        <span className="file-group-count">{files.length}</span>
        <div className="spacer" />
        {group === 'staged' && (
          <button className="icon-button tiny" data-testid="unstage-all" aria-label="Unstage all" title="Unstage all">
            <MinusIcon size={12} />
          </button>
        )}
        {group === 'changes' && (
          <button className="icon-button tiny" data-testid="stage-all" aria-label="Stage all" title="Stage all">
            <StageIcon size={12} />
          </button>
        )}
      </div>
      {files.map((file) => (
        <FileRow key={file.path} file={file} group={group} />
      ))}
    </div>
  );
}

function FileRow({ file, group }: { file: FileChange; group: Group }) {
  const { name, dir } = splitPath(file.path);
  const mark = letter(file, group);
  return (
    <div className="file-row" data-testid="file-row" data-group={group} data-path={file.path} title={file.path}>
      <span className="file-letter mono" style={{ color: letterColor(mark) }}>
        {mark}
      </span>
      <span className={`file-name${isDeletion(file, group) ? ' deleted' : ''}`}>{name}</span>
      <span className="file-dir">{dir}</span>
      {group === 'staged' && isPartlyStaged(file) && <span className="chip">partly staged</span>}
      {group === 'staged' && (
        <button className="icon-button tiny" data-testid="unstage-file" aria-label={`Unstage ${name}`} title="Unstage">
          <MinusIcon size={12} />
        </button>
      )}
      {group === 'changes' && (
        <button className="icon-button tiny" data-testid="stage-file" aria-label={`Stage ${name}`} title="Stage">
          <StageIcon size={12} />
        </button>
      )}
    </div>
  );
}
