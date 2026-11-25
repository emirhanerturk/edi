import { Archive, ArchiveArrowUp, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { CommitSummary, FileChange, StashEntry } from '../../git/types';
import type { BranchList, GitOp, IncomingResult, RepoView, StashList, StashMenuAction, StashRetry, UnpushedResult } from '../../shared/api';
import { shortAgo } from '../history/time';
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
import { StashMenu } from './StashMenu';
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
  stashLabel,
  stashTitle,
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
  /** What is open in the center panel; its row shows as selected. `kind` tells a stash (path: its id) from a file. */
  selected?: { repoPath: string; path: string; kind?: string } | null;
  /** The branch's commits its upstream doesn't have; read when the repo is ahead. */
  loadUnpushed?(repoPath: string): Promise<UnpushedResult>;
  /** The upstream's commits not pulled yet; read when the repo is behind. */
  loadIncoming?(repoPath: string): Promise<IncomingResult>;
  /** An unpushed or incoming commit was clicked: a single click previews, a double click opens a permanent tab. */
  onOpenCommit?(repoPath: string, oid: string, pin: boolean): void;
  /** "Undo commit" on the newest unpushed commit (the caller asks first). */
  onUndoCommit?(repoPath: string, commit: CommitSummary): void;
  /** The open folder is this one repo: its stashes expand it and are all listed. */
  single?: boolean;
  /** The repo's stashes; read when an expanded repo has any. */
  loadStashes?(repoPath: string): Promise<StashList>;
  /** A stash row was clicked: a single click previews, a double click opens a permanent tab. */
  onOpenStash?(repoPath: string, stash: StashEntry, pin: boolean): void;
  /** Pop, apply or drop a stash (the caller asks before dropping). */
  onStashAction?(repoPath: string, stash: StashEntry, action: StashMenuAction): void;
  /** The native right-click menu of a stash row; resolves with the picked action. */
  stashMenu?(canApply: boolean): Promise<StashMenuAction | null>;
  /** A switch or pull git refused because of local changes, per repo: the error box offers to stash and retry it. */
  retries?: Record<string, StashRetry>;
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
  const selectedCommit = props.selected?.repoPath === repo.path && props.selected.kind === 'commit' ? props.selected.path : null;
  const retry = props.retries?.[repo.path];
  const errorBox = error !== undefined && (
    <ErrorBox
      error={error}
      onPull={repo.hasRemote ? () => run({ op: 'pull' }) : undefined}
      retry={retry && { label: retry.op === 'pull' ? 'Stash and pull' : 'Stash and switch', run: () => run({ op: 'stash', message: '', staged: false, then: retry }) }}
      onDismiss={() => props.onDismissError?.(repo.path)}
    />
  );
  const open = isExpanded(status, expanded[repo.path], props.single);
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
            {status.stashes > 0 && (
              <span className="repo-stashes" data-testid="repo-stashes" title={`${status.stashes} ${status.stashes === 1 ? 'stash' : 'stashes'}`}>
                <Archive size={12} strokeWidth={2} aria-hidden="true" />
                <span>{status.stashes}</span>
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
              aside={
                // git can't stash before the first commit.
                !status.unborn && (
                  <StashMenu
                    total={count}
                    staged={groups.staged.length}
                    unstaged={groups.changes.length > 0}
                    partlyStaged={groups.staged.some(isPartlyStaged)}
                    busy={busy}
                    blocked={groups.conflicts.length > 0}
                    onStash={({ message, staged }) => run({ op: 'stash', message, staged })}
                  />
                )
              }
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
          {repo.status && repo.status.upstream !== null && (repo.status.behind ?? 0) > 0 && (
            <IncomingGroup
              repoPath={repo.path}
              upstream={repo.status.upstream}
              headOid={repo.status.headOid}
              behind={repo.status.behind ?? 0}
              load={props.loadIncoming}
              selectedOid={selectedCommit}
              onOpen={(oid, pin) => props.onOpenCommit?.(repo.path, oid, pin)}
            />
          )}
          {repo.status && repo.status.upstream !== null && (repo.status.ahead ?? 0) > 0 && (
            <UnpushedGroup
              repoPath={repo.path}
              headOid={repo.status.headOid}
              ahead={repo.status.ahead ?? 0}
              busy={busy}
              load={props.loadUnpushed}
              selectedOid={selectedCommit}
              onOpen={(oid, pin) => props.onOpenCommit?.(repo.path, oid, pin)}
              onUndo={(commit) => props.onUndoCommit?.(repo.path, commit)}
            />
          )}
          {status.stashes > 0 && (
            <StashGroup
              repoPath={repo.path}
              count={status.stashes}
              current={status.detached ? null : status.head}
              busy={busy}
              canApply={groups.conflicts.length === 0}
              limit={props.single ? null : STASH_PREVIEW}
              load={props.loadStashes}
              selectedOid={props.selected?.repoPath === repo.path && props.selected.kind === 'stash' ? props.selected.path : null}
              onOpen={(stash, pin) => props.onOpenStash?.(repo.path, stash, pin)}
              onAction={(stash, action) => props.onStashAction?.(repo.path, stash, action)}
              menu={props.stashMenu}
            />
          )}
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

/** Sections collapsed or opened by hand, by repo and section, for the session: the panel redraws on every status poll. */
const flippedGroups = new Set<string>();

/** A section's collapse state: open, or closed `byDefault`; a section flipped by hand is kept for the session in `flippedGroups`. */
function useCollapsed(key: string, byDefault = false): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => flippedGroups.has(key) !== byDefault);
  const toggle = () => {
    if (flippedGroups.has(key)) flippedGroups.delete(key);
    else flippedGroups.add(key);
    setCollapsed(!collapsed);
  };
  return [collapsed, toggle];
}

/** A section header: clicking it (outside its buttons) collapses or expands the section. */
function GroupHead(props: { title: string; count: number; collapsed: boolean; onToggle(): void; children?: ReactNode }) {
  const { collapsed, onToggle } = props;
  return (
    <div
      className="file-group-head"
      data-testid="file-group-head"
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onToggle();
      }}
    >
      {collapsed ? <ChevronRight size={11} strokeWidth={1.9} /> : <ChevronDown size={11} strokeWidth={1.9} />}
      <span>{props.title}</span>
      <span className="file-group-count">{props.count}</span>
      <div className="spacer" />
      {props.children}
    </div>
  );
}

function FileGroup({ title, group, files, busy, run, blocked, open, openInZed, selectedPath, repoPath }: FileGroupProps) {
  const [collapsed, toggle] = useCollapsed(`${repoPath}\n${group}`);
  if (files.length === 0) return null;
  return (
    <div className="file-group">
      <GroupHead title={title} count={files.length} collapsed={collapsed} onToggle={toggle}>
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
      </GroupHead>
      {!collapsed && files.map((file) => (
        <FileRow key={file.path} file={file} group={group} busy={busy} run={run} open={open} openInZed={openInZed} selected={file.path === selectedPath} />
      ))}
    </div>
  );
}

/** A commit in the UNPUSHED or INCOMING list: a click previews it in the commit view, a double click keeps the tab. */
function CommitRow(props: { testId: string; commit: CommitSummary; meta: string; metaTitle?: string; selected: boolean; onOpen(oid: string, pin: boolean): void; children?: ReactNode }) {
  const { commit, onOpen } = props;
  return (
    <div
      className="file-row commit-row"
      data-testid={props.testId}
      title={`${commit.short} ${commit.subject}`}
      role="button"
      tabIndex={0}
      aria-current={props.selected ? 'true' : undefined}
      onClick={() => onOpen(commit.oid, false)}
      onDoubleClick={() => onOpen(commit.oid, true)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onOpen(commit.oid, false);
      }}
    >
      <span className="file-name">{commit.subject}</span>
      <span className="commit-row-meta mono" title={props.metaTitle}>
        {props.meta}
      </span>
      <span className="unpushed-time">{shortAgo(commit.date, Date.now())}</span>
      {props.children}
    </div>
  );
}

/** Reads a commit list again whenever one of `deps` moves; null until it arrives (or if it fails). */
function useCommitList<T>(load: ((repoPath: string) => Promise<T>) | undefined, repoPath: string, deps: unknown[]): T | null {
  const [list, setList] = useState<T | null>(null);
  useEffect(() => {
    if (!load) return;
    let current = true;
    load(repoPath).then(
      (result) => current && setList(result),
      () => undefined,
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, repoPath, ...deps]);
  return list;
}

interface UnpushedGroupProps {
  repoPath: string;
  headOid: string | null;
  ahead: number;
  busy: boolean;
  load?(repoPath: string): Promise<UnpushedResult>;
  /** The commit open in the center panel. */
  selectedOid: string | null;
  onOpen(oid: string, pin: boolean): void;
  onUndo(commit: CommitSummary): void;
}

/** Commits made but not pushed yet, newest first; read again whenever HEAD or the count moves. */
function UnpushedGroup({ repoPath, headOid, ahead, busy, load, selectedOid, onOpen, onUndo }: UnpushedGroupProps) {
  const [collapsed, toggle] = useCollapsed(`${repoPath}\nunpushed`);
  const result = useCommitList(load, repoPath, [headOid, ahead]);
  const list = result?.ok ? result : null;
  return (
    <div className="file-group" data-testid="unpushed-group">
      <GroupHead title="UNPUSHED" count={ahead} collapsed={collapsed} onToggle={toggle} />
      {!collapsed &&
        list?.commits.map((commit, index) => (
          <CommitRow key={commit.oid} testId="unpushed-row" commit={commit} meta={commit.short} selected={commit.oid === selectedOid} onOpen={onOpen}>
            {index === 0 && list.canUndo && (
              <button
                className="icon-button tiny"
                data-testid="undo-commit"
                aria-label={`Undo commit ${commit.subject}`}
                title="Undo commit (its changes come back staged)"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onUndo(commit);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Undo2 size={12} strokeWidth={1.8} />
              </button>
            )}
          </CommitRow>
        ))}
    </div>
  );
}

interface IncomingGroupProps {
  repoPath: string;
  /** Like `origin/main`. */
  upstream: string;
  headOid: string | null;
  behind: number;
  load?(repoPath: string): Promise<IncomingResult>;
  /** The commit open in the center panel. */
  selectedOid: string | null;
  onOpen(oid: string, pin: boolean): void;
}

/**
 * The upstream's commits not pulled yet (a teammate's push, once fetched), newest first, with who made
 * each: what Pull would bring. Read again whenever HEAD or the count moves.
 */
function IncomingGroup({ repoPath, upstream, headOid, behind, load, selectedOid, onOpen }: IncomingGroupProps) {
  const [collapsed, toggle] = useCollapsed(`${repoPath}\nincoming`);
  const result = useCommitList(load, repoPath, [headOid, behind]);
  const commits = result?.ok ? result.commits : null;
  return (
    <div className="file-group" data-testid="incoming-group">
      <GroupHead title="INCOMING" count={behind} collapsed={collapsed} onToggle={toggle}>
        <span className="group-hint mono" title={`Fetched from ${upstream}, not pulled yet`}>
          {upstream}
        </span>
      </GroupHead>
      {!collapsed &&
        commits?.map((commit) => (
          <CommitRow
            key={commit.oid}
            testId="incoming-row"
            commit={commit}
            meta={commit.authorName || commit.authorEmail}
            metaTitle={`${commit.authorName} <${commit.authorEmail}>`}
            selected={commit.oid === selectedOid}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
}

/** With several repos, a repo shows this many stashes until "Show N more". */
const STASH_PREVIEW = 5;
/** Repos whose whole stash list was opened with "Show N more", for the session. */
const longStashLists = new Set<string>();

interface StashGroupProps {
  repoPath: string;
  /** The count from the status; the header shows it. */
  count: number;
  /** The current branch; null on a detached HEAD. A stash made on another branch says which. */
  current: string | null;
  busy: boolean;
  /** No conflict in the repo: git can pop or apply. */
  canApply: boolean;
  /** How many show before "Show N more"; null for all. */
  limit: number | null;
  load?(repoPath: string): Promise<StashList>;
  /** The stash open in the center panel. */
  selectedOid: string | null;
  onOpen(stash: StashEntry, pin: boolean): void;
  onAction(stash: StashEntry, action: StashMenuAction): void;
  menu?(canApply: boolean): Promise<StashMenuAction | null>;
}

/** The repo's stashes, newest first, closed until opened; read again whenever the count moves or an operation starts or ends (a rename). */
function StashGroup({ repoPath, count, current, busy, canApply, limit, load, selectedOid, onOpen, onAction, menu }: StashGroupProps) {
  const [collapsed, toggle] = useCollapsed(`${repoPath}\nstashes`, true);
  const [list, setList] = useState<StashEntry[] | null>(null);
  const [all, setAll] = useState(() => longStashLists.has(repoPath));
  useEffect(() => {
    if (!load) return;
    let live = true;
    load(repoPath).then(
      (result) => live && setList(result.ok ? result.stashes : null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [load, repoPath, count, busy]);
  const now = Date.now();
  const shown = list === null ? [] : limit === null || all ? list : list.slice(0, limit);
  const hidden = (list?.length ?? 0) - shown.length;
  return (
    <div className="file-group" data-testid="stash-group">
      <GroupHead title="STASHES" count={count} collapsed={collapsed} onToggle={toggle} />
      {!collapsed && (
        <>
          {shown.map((stash) => {
            const { wip, text } = stashLabel(stash);
            const title = stashTitle(stash);
            return (
              <div
                key={stash.oid}
                className="file-row stash-row"
                data-testid="stash-row"
                title={`stash@{${stash.index}}: ${stash.subject}`}
                role="button"
                tabIndex={0}
                aria-current={stash.oid === selectedOid ? 'true' : undefined}
                onClick={() => onOpen(stash, false)}
                onDoubleClick={() => onOpen(stash, true)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  onOpen(stash, false);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (busy || !menu) return;
                  void menu(canApply).then((action) => action && onAction(stash, action));
                }}
              >
                <span className="stash-label">
                  {wip && <span className="stash-wip">WIP</span>}
                  <span className={wip ? 'stash-base' : 'stash-message'}>{text === '' ? '(no subject)' : text}</span>
                </span>
                {stash.branch !== null && stash.branch !== current && (
                  <span className="stash-branch mono" title={`Stashed on ${stash.branch}`}>
                    {stash.branch}
                  </span>
                )}
                <span className="unpushed-time">{shortAgo(stash.date, now)}</span>
                <button
                  className="icon-button tiny"
                  data-testid="stash-pop"
                  aria-label={`Pop stash ${title}`}
                  title={canApply ? 'Pop: bring the changes back and remove the stash' : 'Resolve the conflicts first'}
                  disabled={busy || !canApply}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction(stash, 'pop');
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <ArchiveArrowUp size={13} strokeWidth={2} />
                </button>
              </div>
            );
          })}
          {hidden > 0 && (
            <button
              className="stash-more"
              data-testid="stash-more"
              onClick={() => {
                longStashLists.add(repoPath);
                setAll(true);
              }}
            >
              Show {hidden} more
            </button>
          )}
        </>
      )}
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
