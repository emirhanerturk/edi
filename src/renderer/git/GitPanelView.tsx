import { type ReactNode, useState } from 'react';
import type { FileChange } from '../../git/types';
import type { BranchList, GitOp, RepoView } from '../../shared/api';
import {
  ArrowDown,
  ArrowUp,
  BranchIcon,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  ClaudeMark,
  ExternalIcon,
  MinusIcon,
  Spinner,
  StageIcon,
  TerminalIcon,
  WarningIcon,
} from '../components/icons';
import { BranchMenu } from './BranchMenu';
import { CommitBox } from './CommitBox';
import { ErrorBox } from './ErrorBox';
import {
  type Group,
  type SyncAction,
  changeCount,
  commitTarget,
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
  /** Repos the user expanded or collapsed by hand (path → expanded?). */
  expanded: Record<string, boolean>;
  onToggle(repoPath: string, open: boolean): void;
  onOpenTerminal?(repoPath: string): void;
  /** Commit messages being written (path → text). */
  drafts?: Record<string, string>;
  /** Error from the last operation (path → git's line). */
  errors?: Record<string, string>;
  onDraft?(repoPath: string, message: string): void;
  onOp?(repoPath: string, op: GitOp): void;
  onDismissError?(repoPath: string): void;
  /** Opens the file in Zed (for conflicted files). */
  onOpenInZed?(repoPath: string, path: string): void;
  loadBranches?(repoPath: string): Promise<BranchList>;
  /** A file row was clicked: a single click previews (`pin` false), a double click opens a permanent tab. */
  onOpenFile?(repoPath: string, file: FileChange, pin: boolean): void;
  /** The file open in the center panel; its row shows as selected. */
  selected?: { repoPath: string; path: string } | null;
}

const NO_BRANCHES: BranchList = { ok: true, branches: [], current: null };

/** Git tab: all repos one below the other. The tab header lives in the right panel. */
export function GitPanelView(props: GitPanelProps) {
  const { repos } = props;
  return (
    <div className="git-list">
      {repos.length === 0 && <p className="git-empty">No git repositories in this folder</p>}
      {repos.map((repo) => (
        <Repo key={repo.path} repo={repo} {...props} />
      ))}
    </div>
  );
}

function Repo(props: GitPanelProps & { repo: RepoView }) {
  const { repo, expanded, onToggle, onOpenTerminal } = props;
  const { status } = repo;
  const error = props.errors?.[repo.path];
  const run = (op: GitOp) => props.onOp?.(repo.path, op);
  const busy = repo.busy !== null;
  const errorBox = error !== undefined && (
    <ErrorBox error={error} onPull={repo.hasRemote ? () => run({ op: 'pull' }) : undefined} onDismiss={() => props.onDismissError?.(repo.path)} />
  );
  const open = isExpanded(status, expanded[repo.path]);
  const fileProps = {
    open: (file: FileChange, pin: boolean) => props.onOpenFile?.(repo.path, file, pin),
    selectedPath: props.selected?.repoPath === repo.path ? props.selected.path : null,
    openInZed: (file: FileChange) => props.onOpenInZed?.(repo.path, file.path),
    repoPath: repo.path,
  };

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
      <div
        className="repo-head toggles"
        onClick={(event) => {
          // The row's empty space, branch name and counts also expand and collapse it; buttons (including the name button),
          // menus and fields do their own thing.
          if ((event.target as HTMLElement).closest('button, a, input, textarea, [role="menu"]')) return;
          onToggle(repo.path, !open);
        }}
      >
        <button className="repo-toggle" data-testid="repo-toggle" onClick={() => onToggle(repo.path, !open)}>
          {open ? <ChevronDown size={11} strokeWidth={1.9} /> : <ChevronRight size={11} strokeWidth={1.9} />}
          <span className="repo-name">{repo.name}</span>
        </button>
        {repo.claude > 0 && <ClaudeMark size={12} label="Claude Code session open" />}
        {groups.conflicts.length > 0 && <span className="chip chip-warn">merging</span>}
        <div className="spacer" />

        {open ? (
          <>
            {status.detached ? (
              <span className="branch-chip mono" title={`Detached HEAD at ${status.head}`}>
                <BranchIcon size={11} />
                <span className="branch-name">{status.head}</span>
              </span>
            ) : (
              <BranchMenu
                current={status.head}
                disabled={busy}
                load={() => props.loadBranches?.(repo.path) ?? Promise.resolve(NO_BRANCHES)}
                onSwitch={(branch) => run({ op: 'switch', branch })}
                onCreate={(branch) => run({ op: 'createBranch', branch })}
              />
            )}
            {repo.busy ? (
              <Busy label={repo.busy} />
            ) : (
              <SyncIcons
                ahead={status.ahead ?? 0}
                behind={status.behind ?? 0}
                hasRemote={repo.hasRemote}
                publish={action?.kind === 'publish'}
                onPull={() => run({ op: 'pull' })}
                onPush={() => run({ op: 'push' })}
              />
            )}
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
            {repo.busy ? <Busy label={repo.busy} /> : <SyncButton action={action} onClick={() => run({ op: action?.kind === 'pull' ? 'pull' : 'push' })} />}
          </>
        )}
      </div>

      {errorBox}

      {open && (
        <div className="repo-body">
          {count > 0 && (
            <CommitBox
              target={commitTarget(groups)}
              message={props.drafts?.[repo.path] ?? ''}
              busy={busy}
              canPush={repo.hasRemote}
              onChange={(message) => props.onDraft?.(repo.path, message)}
              onCommit={({ all, push }) => run({ op: 'commit', message: props.drafts?.[repo.path] ?? '', all, push })}
            />
          )}
          {groups.conflicts.length > 0 && (
            <p className="repo-note">
              {groups.conflicts.length === 1 ? '1 file has conflicts. Resolve it' : `${groups.conflicts.length} files have conflicts. Resolve them`}{' '}
              in your editor, then stage {groups.conflicts.length === 1 ? 'it' : 'them'} from a terminal. edi does not mark
              conflicts as resolved.
            </p>
          )}
          <FileGroup title="CONFLICTS" group="conflicts" files={groups.conflicts} busy={busy} run={run} {...fileProps} />
          <FileGroup title="STAGED" group="staged" files={groups.staged} busy={busy} run={run} blocked={groups.conflicts.length > 0} {...fileProps} />
          <FileGroup title="CHANGES" group="changes" files={groups.changes} busy={busy} run={run} blocked={groups.conflicts.length > 0} {...fileProps} />
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

function SyncButton({ action, onClick }: { action: SyncAction; onClick(): void }) {
  if (!action) return null;
  return (
    <button className={`sync-button sync-${action.kind}`} data-testid="sync-button" onClick={onClick}>
      {action.kind === 'pull' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
      <span>{action.label}</span>
    </button>
  );
}

/** Pull and push buttons in an expanded repo's header; with the count when commits are pending. */
function SyncIcons(props: { ahead: number; behind: number; hasRemote: boolean; publish: boolean; onPull(): void; onPush(): void }) {
  const { ahead, behind, hasRemote, publish } = props;
  const pushTitle = !hasRemote ? 'No remote' : publish ? 'Publish branch' : ahead > 0 ? `Push ${ahead}` : 'Push';
  return (
    <>
      <button
        className={`icon-button small${behind > 0 ? ' has-pull' : ''}`}
        aria-label="Pull"
        title={!hasRemote ? 'No remote' : behind > 0 ? `Pull ${behind}` : 'Pull'}
        disabled={!hasRemote}
        onClick={props.onPull}
      >
        <ArrowDown size={13} strokeWidth={1.7} />
        {behind > 0 && <span className="icon-count">{behind}</span>}
      </button>
      <button
        className={`icon-button small${ahead > 0 || publish ? ' has-push' : ''}`}
        aria-label="Push"
        title={pushTitle}
        disabled={!hasRemote}
        onClick={props.onPush}
      >
        <ArrowUp size={13} strokeWidth={1.7} />
        {ahead > 0 && <span className="icon-count">{ahead}</span>}
      </button>
    </>
  );
}

interface FileGroupProps {
  title: string;
  group: Group;
  files: FileChange[];
  busy: boolean;
  run(op: GitOp): void;
  open(file: FileChange, pin: boolean): void;
  openInZed(file: FileChange): void;
  /** Path of the file open in the center panel, in this repo. */
  selectedPath: string | null;
  /** "Stage all / revert all" is disabled during a conflict: both would erase the conflict record. */
  blocked?: boolean;
  repoPath: string;
}

/** Collapsed file groups, by repo and group, for the session: the panel redraws on every status poll. */
const collapsedGroups = new Set<string>();

function FileGroup({ title, group, files, busy, run, blocked, open, openInZed, selectedPath, repoPath }: FileGroupProps) {
  const key = `${repoPath}\n${group}`;
  const [collapsed, setCollapsed] = useState(() => collapsedGroups.has(key));
  if (files.length === 0) return null;
  const toggle = () => {
    if (collapsed) collapsedGroups.delete(key);
    else collapsedGroups.add(key);
    setCollapsed(!collapsed);
  };
  return (
    <div className="file-group">
      <div
        className="file-group-head"
        data-testid="file-group-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          toggle();
        }}
      >
        {collapsed ? <ChevronRight size={11} strokeWidth={1.9} /> : <ChevronDown size={11} strokeWidth={1.9} />}
        <span>{title}</span>
        <span className="file-group-count">{files.length}</span>
        <div className="spacer" />
        {group === 'staged' && (
          <button
            className="icon-button tiny"
            data-testid="unstage-all"
            aria-label="Unstage all"
            title={blocked ? 'Resolve the conflicts first' : 'Unstage all'}
            disabled={busy || blocked}
            onClick={() => run({ op: 'unstageAll' })}
          >
            <MinusIcon size={12} />
          </button>
        )}
        {group === 'changes' && (
          <button
            className="icon-button tiny"
            data-testid="stage-all"
            aria-label="Stage all"
            title={blocked ? 'Resolve the conflicts first' : 'Stage all'}
            disabled={busy || blocked}
            onClick={() => run({ op: 'stageAll' })}
          >
            <StageIcon size={12} />
          </button>
        )}
      </div>
      {!collapsed && files.map((file) => (
        <FileRow key={file.path} file={file} group={group} busy={busy} run={run} open={open} openInZed={openInZed} selected={file.path === selectedPath} />
      ))}
    </div>
  );
}

interface FileRowProps {
  file: FileChange;
  group: Group;
  busy: boolean;
  selected: boolean;
  run(op: GitOp): void;
  open(file: FileChange, pin: boolean): void;
  openInZed(file: FileChange): void;
}

/** Clicking a row opens the file in the center panel; the button on the right only stages or reverts. */
function FileRow({ file, group, busy, selected, run, open, openInZed }: FileRowProps) {
  const { name, dir } = splitPath(file.path);
  const mark = letter(file, group);
  const button = (testId: string, label: string, title: string, action: GitOp | (() => void), icon: ReactNode, disabled = busy) => (
    <button
      className="icon-button tiny"
      data-testid={testId}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (typeof action === 'function') action();
        else run(action);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {icon}
    </button>
  );
  return (
    <div
      className="file-row"
      data-testid="file-row"
      data-group={group}
      data-path={file.path}
      title={file.path}
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      onClick={() => open(file, false)}
      onDoubleClick={() => open(file, true)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        open(file, false);
      }}
    >
      <span className="file-letter mono" style={{ color: letterColor(mark) }}>
        {mark}
      </span>
      <span className={`file-name${isDeletion(file, group) ? ' deleted' : ''}`}>{name}</span>
      <span className="file-dir">{dir}</span>
      {group === 'staged' && isPartlyStaged(file) && <span className="chip">partly staged</span>}
      {group === 'staged' && button('unstage-file', `Unstage ${name}`, 'Unstage', { op: 'unstage', file }, <MinusIcon size={12} />)}
      {group === 'conflicts' && button('open-in-zed', `Open ${name} in Zed`, 'Open in Zed', () => openInZed(file), <ExternalIcon size={12} />, false)}
      {group === 'changes' && button('stage-file', `Stage ${name}`, 'Stage', { op: 'stage', file }, <StageIcon size={12} />)}
    </div>
  );
}
