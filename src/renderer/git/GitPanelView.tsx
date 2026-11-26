import { openKey } from '../components/keys';
import { OpenInMenu } from '../components/OpenInMenu';
import type { EditorId } from '../../shared/editors';
import { Archive, ArchiveArrowUp, RotateCcw, Undo2 } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
import type { CommitSummary, FileChange, StashEntry } from '../../git/types';
import type { BranchList, GitOp, IncomingResult, RepoOperation, RepoView, StashList, StashMenuAction, StashRetry, UnpushedResult } from '../../shared/api';
import { discardHow } from '../../git/discardKind';
import { shortAgo } from '../history/time';
import {
  ArrowDown,
  ArrowUp,
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
import { NoRepos } from '../components/NoRepos';
import { StashMenu } from './StashMenu';
import { SparkButton, problemText } from '../summaries/SummaryCard';
import { PlaceCard, type SummaryPlace, SummarySpark, closeSummary, startSummary } from '../summaries/places';
import { PullRequestActions, PullRequestBody } from '../summaries/pullRequest';
import { readingCommits, readingFiles, readingText, summaryKey, useSummary } from '../summaries/summaryStore';
import { useNow } from '../components/useNow';
import {
  type Group,
  type SyncAction,
  changeCount,
  cleanNote,
  commitTarget,
  groupFiles,
  isDeletion,
  isExpanded,
  isPartlyStaged,
  letter,
  letterColor,
  nextAction,
  splitPath,
  stashLabel,
  stashTitle,
  syncAction,
} from './model';

export interface GitPanelProps {
  repos: RepoView[];
  /** Repos the project ignores: with none shown, the empty tab says so and offers Edit project…. */
  ignored?: number;
  onEditProject?(): void;
  /** Repos the user expanded or collapsed by hand (path → expanded?). */
  expanded: Record<string, boolean>;
  onToggle(repoPath: string, open: boolean): void;
  onOpenTerminal?(repoPath: string): void;
  /** Starts Claude Code in a new terminal tab in the repository. */
  onOpenClaude?(repoPath: string): void;
  /** Commit messages being written (path → text). */
  drafts?: Record<string, string>;
  /** Error from the last operation (path → git's line). */
  errors?: Record<string, string>;
  onDraft?(repoPath: string, message: string): void;
  onOp?(repoPath: string, op: GitOp): void;
  onDismissError?(repoPath: string): void;
  /** Opens the file in Zed (for conflicted files). */
  onOpenIn?(repoPath: string, path: string, editor: EditorId): void;
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
  /** Discard in CHANGES: one file's unstaged changes, or all of them when `file` is null (the caller asks first). */
  onDiscard?(repoPath: string, file: FileChange | null): void;
  /** Right-click on a changed file's row. */
  onFileMenu?(repoPath: string, file: FileChange, group: Group): void;
  /** A key on a changed file's row: ⌥⌘C, ⇧⌥⌘C or ⌥⌘R (what its menu shows). */
  onFileKey?(repoPath: string, file: FileChange, action: 'copyPath' | 'copyRelativePath' | 'reveal'): void;
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
  /** Claude summaries: the sparkle buttons (incoming, changes, the commit message, a pull request, stashes) and their cards. */
  summaries?: boolean;
  /** "Push and open on GitHub" on a drafted pull request: push the branch, then open the page (`url`). */
  onOpenPullRequest?(repoPath: string, url: string): void;
  /** "Use as its name" on a stash's summary. */
  onRenameStash?(repoPath: string, stash: StashEntry, name: string): void;
}

const NO_BRANCHES: BranchList = { ok: true, branches: [], current: null };

/** Git tab: all repos one below the other. The tab header lives in the right panel. */
export function GitPanelView(props: GitPanelProps) {
  const { repos } = props;
  return (
    <div className="git-list">
      {repos.length === 0 && <NoRepos ignored={props.ignored} onEditProject={props.onEditProject} />}
      {repos.map((repo) => (
        <Repo key={repo.path} repo={repo} {...props} />
      ))}
    </div>
  );
}

/** A terminal, and Claude Code, in the repository: on the open repository's row, and on hover on a closed one. */
function LaunchButtons({ repoName, onTerminal, onClaude }: { repoName: string; onTerminal(): void; onClaude?: () => void }) {
  return (
    <>
      <button className="icon-button small" aria-label={`Open a terminal in ${repoName}`} title="Open a terminal in this repository" onClick={onTerminal}>
        <TerminalIcon size={13} />
      </button>
      {onClaude && (
        <button className="icon-button small" aria-label={`Start Claude Code in ${repoName}`} title="Start Claude Code in this repository" onClick={onClaude}>
          <ClaudeMark size={12} />
        </button>
      )}
    </>
  );
}

function Repo(props: GitPanelProps & { repo: RepoView }) {
  const { repo, expanded, onToggle, onOpenTerminal, onOpenClaude } = props;
  const { status } = repo;
  const summaries = props.summaries === true;
  // Claude Code is writing the commit message: the box waits for it.
  const writing = useSummary(summaryKey.message(repo.path))?.result === null;
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
    selectedKind: props.selected?.kind ?? null,
    openIn: (file: FileChange, editor: EditorId) => props.onOpenIn?.(repo.path, file.path, editor),
    repoPath: repo.path,
    discard: props.onDiscard && ((file: FileChange | null) => props.onDiscard!(repo.path, file)),
    menu: props.onFileMenu && ((file: FileChange, group: Group) => props.onFileMenu!(repo.path, file, group)),
    fileKey: props.onFileKey && ((file: FileChange, action: 'copyPath' | 'copyRelativePath' | 'reveal') => props.onFileKey!(repo.path, file, action)),
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
  // What the changes do: on CHANGES, or on STAGED when everything is staged.
  const changesPlace: SummaryPlace = { key: summaryKey.changes(repo.path), request: { kind: 'changes', repoPath: repo.path }, reading: readingFiles(count) };
  const changesOn = groups.changes.length > 0 ? 'changes' : 'staged';
  const changesSummary = summaries && {
    head: <SummarySpark place={changesPlace} title="Summarize the changes" testId="summarize-changes" />,
    card: <PlaceCard place={changesPlace} label="WHAT CHANGED" testId="changes-summary" />,
  };

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
        <OperationChip operation={repo.operation ?? null} conflicts={groups.conflicts.length} />
        <div className="spacer" />

        {open ? (
          <>
            {/* On a detached HEAD too: the way back to a branch, or to a new one at this commit. */}
            <BranchMenu
              current={status.head}
              title={status.detached ? `Detached HEAD at ${status.head}: pick a branch to switch back` : undefined}
              disabled={busy}
              load={() => props.loadBranches?.(repo.path) ?? Promise.resolve(NO_BRANCHES)}
              onSwitch={(branch) => run({ op: 'switch', branch })}
              onCreate={(branch) => run({ op: 'createBranch', branch })}
            />
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
            <LaunchButtons repoName={repo.name} onTerminal={() => onOpenTerminal?.(repo.path)} onClaude={onOpenClaude && (() => onOpenClaude(repo.path))} />
          </>
        ) : (
          <>
            {/* On hover: a terminal or Claude Code in this repository. */}
            <span className="repo-launch">
              <LaunchButtons repoName={repo.name} onTerminal={() => onOpenTerminal?.(repo.path)} onClaude={onOpenClaude && (() => onOpenClaude(repo.path))} />
            </span>
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
          {/* Stays when there is nothing to commit: its buttons wait for a change; the text typed is kept. */}
          <CommitBox
            target={commitTarget(groups)}
            message={props.drafts?.[repo.path] ?? ''}
            busy={busy}
            writing={writing}
            messageButton={summaries ? <MessageSpark repoPath={repo.path} files={count} onWritten={(message) => props.onDraft?.(repo.path, message)} /> : undefined}
            canPush={repo.hasRemote}
            onChange={(message) => props.onDraft?.(repo.path, message)}
            onCommit={({ all, push }) => run({ op: 'commit', message: props.drafts?.[repo.path] ?? '', all, push })}
            next={nextAction(status, repo.hasRemote)}
            onNext={() => run({ op: nextAction(status, repo.hasRemote)?.kind === 'pull' ? 'pull' : 'push' })}
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
                  message={props.drafts?.[repo.path] ?? ''}
                  onStash={({ staged }) => run({ op: 'stash', message: props.drafts?.[repo.path] ?? '', staged })}
                />
              )
            }
          />
          {summaries && <MessageProblem repoPath={repo.path} />}
          {groups.conflicts.length > 0 && (
            <p className="repo-note">
              {groups.conflicts.length === 1 ? '1 file has conflicts. Resolve it' : `${groups.conflicts.length} files have conflicts. Resolve them`}{' '}
              in your editor, then stage {groups.conflicts.length === 1 ? 'it' : 'them'} from a terminal. edi does not mark
              conflicts as resolved.
            </p>
          )}
          <FileGroup title="CONFLICTS" group="conflicts" files={groups.conflicts} busy={busy} run={run} {...fileProps} />
          <FileGroup
            title="STAGED"
            group="staged"
            files={groups.staged}
            busy={busy}
            run={run}
            blocked={groups.conflicts.length > 0}
            summary={changesOn === 'staged' ? changesSummary : false}
            {...fileProps}
          />
          <FileGroup
            title="CHANGES"
            group="changes"
            files={groups.changes}
            busy={busy}
            run={run}
            blocked={groups.conflicts.length > 0}
            summary={changesOn === 'changes' ? changesSummary : false}
            {...fileProps}
          />
          {count === 0 && <p className="repo-clean">{cleanNote(status, repo.hasRemote)}</p>}
          {repo.status && repo.status.upstream !== null && (repo.status.behind ?? 0) > 0 && (
            <IncomingGroup
              repoPath={repo.path}
              upstream={repo.status.upstream}
              headOid={repo.status.headOid}
              behind={repo.status.behind ?? 0}
              summaries={summaries}
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
              summaries={summaries}
              onOpenPullRequest={props.onOpenPullRequest && ((url) => props.onOpenPullRequest!(repo.path, url))}
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
              summaries={summaries}
              onRename={props.onRenameStash && ((stash, name) => props.onRenameStash!(repo.path, stash, name))}
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
  menu?(file: FileChange, group: Group): void;
  fileKey?(file: FileChange, action: 'copyPath' | 'copyRelativePath' | 'reveal'): void;
  title: string;
  group: Group;
  files: FileChange[];
  busy: boolean;
  run(op: GitOp): void;
  open(file: FileChange, pin: boolean): void;
  openIn(file: FileChange, editor: EditorId): void;
  /** Path of the file open in the center panel, in this repo. */
  selectedPath: string | null;
  /** What it is open in (`diff`, `file`): a row is selected only while what it opens is the one showing. */
  selectedKind: string | null;
  /** "Stage all / revert all" is disabled during a conflict: both would erase the conflict record. */
  blocked?: boolean;
  repoPath: string;
  /** CHANGES only: discards a file, or all of them with null. No buttons without it. */
  discard?(file: FileChange | null): void;
  /** The changes' Claude summary: its sparkle first in the header, its card under it. */
  summary?: { head: ReactNode; card: ReactNode } | false;
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

/** What clicking a changed file's row opens: a new file has no old version, so it opens in the file view. */
export const opensIn = (file: FileChange) => (file.kind === 'untracked' ? 'file' : 'diff');

function FileGroup({ title, group, files, busy, run, blocked, open, openIn, selectedPath, selectedKind, repoPath, discard: discardAny, menu, fileKey, summary }: FileGroupProps) {
  const discard = group === 'changes' ? discardAny : undefined;
  const [collapsed, toggle] = useCollapsed(`${repoPath}\n${group}`);
  if (files.length === 0) return null;
  return (
    <div className="file-group">
      <GroupHead title={title} count={files.length} collapsed={collapsed} onToggle={toggle}>
        {summary && summary.head}
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
        {discard && (
          <button
            className="icon-button tiny"
            data-testid="discard-all"
            aria-label="Discard all changes"
            title={blocked ? 'Resolve the conflicts first' : 'Discard all changes'}
            disabled={busy || blocked}
            onClick={() => discard(null)}
          >
            <RotateCcw size={12} />
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
      {summary && summary.card}
      {!collapsed && files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          group={group}
          busy={busy}
          blocked={blocked}
          discard={discard}
          run={run}
          open={open}
          openIn={openIn}
          menu={menu}
          fileKey={fileKey}
          selected={file.path === selectedPath && selectedKind === opensIn(file)}
        />
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
        if (event.target === event.currentTarget) openKey(event, (pin) => onOpen(commit.oid, pin));
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
  /** Draft a pull request with Claude Code. */
  summaries?: boolean;
  onOpenPullRequest?(url: string): void;
  load?(repoPath: string): Promise<UnpushedResult>;
  /** The commit open in the center panel. */
  selectedOid: string | null;
  onOpen(oid: string, pin: boolean): void;
  onUndo(commit: CommitSummary): void;
}

/** Commits made but not pushed yet, newest first; read again whenever HEAD or the count moves. */
function UnpushedGroup({ repoPath, headOid, ahead, busy, summaries, onOpenPullRequest, load, selectedOid, onOpen, onUndo }: UnpushedGroupProps) {
  const [collapsed, toggle] = useCollapsed(`${repoPath}\nunpushed`);
  const result = useCommitList(load, repoPath, [headOid, ahead]);
  const list = result?.ok ? result : null;
  const place: SummaryPlace = { key: summaryKey.pullRequest(repoPath), request: { kind: 'pullRequest', repoPath }, reading: readingText("the branch's commits") };
  return (
    <div className="file-group" data-testid="unpushed-group">
      <GroupHead title="UNPUSHED" count={ahead} collapsed={collapsed} onToggle={toggle}>
        {summaries && <SummarySpark place={place} title="Draft a pull request" testId="draft-pull-request" />}
      </GroupHead>
      {summaries && (
        <PlaceCard
          place={place}
          label="PULL REQUEST"
          testId="pull-request-draft"
          againLabel="Draft again"
          closeLabel="Close the draft"
          body={(done) => <PullRequestBody title={done.title ?? ''} body={done.text} />}
          actions={(done) => <PullRequestActions done={done} onOpen={onOpenPullRequest} busy={busy} />}
        />
      )}
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
  /** Summarize them with Claude Code. */
  summaries?: boolean;
  load?(repoPath: string): Promise<IncomingResult>;
  /** The commit open in the center panel. */
  selectedOid: string | null;
  onOpen(oid: string, pin: boolean): void;
}

/**
 * The upstream's commits not pulled yet (a teammate's push, once fetched), newest first, with who made
 * each: what Pull would bring. Read again whenever HEAD or the count moves.
 */
function IncomingGroup({ repoPath, upstream, headOid, behind, summaries, load, selectedOid, onOpen }: IncomingGroupProps) {
  const [collapsed, toggle] = useCollapsed(`${repoPath}\nincoming`);
  const result = useCommitList(load, repoPath, [headOid, behind]);
  const commits = result?.ok ? result.commits : null;
  const place: SummaryPlace = { key: summaryKey.incoming(repoPath), request: { kind: 'incoming', repoPath }, reading: readingCommits(behind) };
  return (
    <div className="file-group" data-testid="incoming-group">
      <GroupHead title="INCOMING" count={behind} collapsed={collapsed} onToggle={toggle}>
        {summaries && <SummarySpark place={place} title="Summarize the incoming commits" testId="summarize-incoming" />}
        <span className="group-hint mono" title={`Fetched from ${upstream}, not pulled yet`}>
          {upstream}
        </span>
      </GroupHead>
      {summaries && <PlaceCard place={place} label="SUMMARY" testId="incoming-summary" />}
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
  /** A stash's one-line summary from Claude Code, on hover; it can become the stash's name. */
  summaries?: boolean;
  onRename?(stash: StashEntry, name: string): void;
}

/** The repo's stashes, newest first, closed until opened; read again whenever the count moves or an operation starts or ends (a rename). */
function StashGroup({ repoPath, count, current, busy, canApply, limit, load, selectedOid, onOpen, onAction, menu, summaries, onRename }: StashGroupProps) {
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
            const place = stashPlace(repoPath, stash);
            return (
              <Fragment key={stash.oid}>
              <div
                className="file-row stash-row"
                data-testid="stash-row"
                title={`stash@{${stash.index}}: ${stash.subject}`}
                role="button"
                tabIndex={0}
                aria-current={stash.oid === selectedOid ? 'true' : undefined}
                onClick={() => onOpen(stash, false)}
                onDoubleClick={() => onOpen(stash, true)}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget) openKey(event, (pin) => onOpen(stash, pin));
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
                {summaries && <SummarySpark place={place} title="Summarize this stash" testId="summarize-stash" className="stash-spark" />}
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
              {summaries && <StashSummary place={place} busy={busy} onUse={onRename && ((name) => onRename(stash, name))} />}
              </Fragment>
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
  openIn(file: FileChange, editor: EditorId): void;
  /** There are conflicts in the repo: discarding is refused. */
  blocked?: boolean;
  discard?(file: FileChange): void;
  menu?(file: FileChange, group: Group): void;
  fileKey?(file: FileChange, action: 'copyPath' | 'copyRelativePath' | 'reveal'): void;
}

/** Clicking a row opens the file in the center panel; the buttons on the right only discard, stage or unstage. */
function FileRow({ file, group, busy, blocked, discard, selected, run, open, openIn, menu, fileKey }: FileRowProps) {
  const { name, dir } = splitPath(file.path);
  const mark = letter(file, group);
  const discardButton = () => {
    const plan = discardHow(file);
    const refused = plan.how === 'refuse' ? plan.reason : null;
    const title = blocked ? 'Resolve the conflicts first' : (refused ?? 'Discard changes');
    return button('discard-file', `Discard changes to ${name}`, title, () => discard?.(file), <RotateCcw size={12} />, busy || blocked || refused !== null);
  };
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
        if (event.target !== event.currentTarget) return;
        if (openKey(event, (pin) => open(file, pin))) return;
        // The keys its menu shows; by position, as Option changes the character.
        if (!fileKey || !event.metaKey || !event.altKey || event.ctrlKey) return;
        const action = event.code === 'KeyC' ? (event.shiftKey ? 'copyRelativePath' : 'copyPath') : event.code === 'KeyR' && !event.shiftKey ? 'reveal' : null;
        if (action === null) return;
        event.preventDefault();
        fileKey(file, action);
      }}
      onContextMenu={
        menu &&
        ((event) => {
          event.preventDefault();
          menu(file, group);
        })
      }
    >
      <span className="file-letter mono" style={{ color: letterColor(mark) }}>
        {mark}
      </span>
      <span className={`file-name${isDeletion(file, group) ? ' deleted' : ''}`}>{name}</span>
      <span className="file-dir">{dir}</span>
      {group === 'staged' && isPartlyStaged(file) && <span className="chip">partly staged</span>}
      {/* Shown while the pointer is over the row (or a button in it has focus); spaced like the header's. */}
      <div className="file-actions">
        {group === 'staged' && button('unstage-file', `Unstage ${name}`, 'Unstage', { op: 'unstage', file }, <MinusIcon size={12} />)}
        {group === 'conflicts' && (
          <OpenInMenu
            className="open-in-row"
            onOpen={(editor) => openIn(file, editor)}
            button={({ open: shown, toggle }) => (
              <button
                className="icon-button tiny"
                data-testid="open-in"
                aria-label={`Open ${name} in…`}
                aria-haspopup="menu"
                aria-expanded={shown}
                onClick={toggle}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <ExternalIcon size={12} />
              </button>
            )}
          />
        )}
        {discard && discardButton()}
        {group === 'changes' && button('stage-file', `Stage ${name}`, 'Stage', { op: 'stage', file }, <StageIcon size={12} />)}
      </div>
    </div>
  );
}

const OPERATION_LABELS: Record<RepoOperation, string> = {
  merge: 'merging',
  rebase: 'rebasing',
  'cherry-pick': 'cherry-picking',
  revert: 'reverting',
};

/**
 * In the repo header: the operation git is in the middle of, or "conflicts" for conflicts outside one
 * (a stash applied with conflicts). Nothing if neither.
 */
function OperationChip({ operation, conflicts }: { operation: RepoOperation | null; conflicts: number }) {
  if (operation === null && conflicts === 0) return null;
  const label = operation === null ? 'conflicts' : OPERATION_LABELS[operation];
  const files = conflicts === 0 ? '' : ` ${conflicts} ${conflicts === 1 ? 'file has' : 'files have'} conflicts.`;
  const title = operation === null ? `${files.trim()} Resolve them and stage the files.` : `A ${operation} is waiting to be finished.${files}`;
  return (
    <span className="chip chip-warn" data-testid="operation-chip" title={title}>
      {label}
    </span>
  );
}

const stashPlace = (repoPath: string, stash: StashEntry): SummaryPlace => ({
  key: summaryKey.stash(repoPath, stash.oid),
  request: { kind: 'stash', repoPath, oid: stash.oid },
  reading: readingText('this stash'),
});

/**
 * Under a stash's row once its sparkle was clicked: reading, then one line about it, which can become its name;
 * or why there is none.
 */
function StashSummary({ place, busy, onUse }: { place: SummaryPlace; busy: boolean; onUse?(name: string): void }) {
  const run = useSummary(place.key);
  const now = useNow(30_000);
  if (!run) return null;
  const { result } = run;
  const close = () => closeSummary(place.key);
  if (result === null) {
    return (
      <div className="stash-summary" data-testid="stash-summary" data-state="running" aria-busy="true">
        <div className="summary-head">
          <span className="summary-reading">{run.reading}</span>
          <button className="summary-button" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  if (!result.ok) {
    const { title, detail } = problemText(result, now);
    return (
      <div className="stash-summary" data-testid="stash-summary" data-state="error" role="alert">
        <span className="summary-problem">{title}</span>
        <span className="summary-detail">{detail}</span>
        <div className="stash-summary-actions">
          {result.reason !== 'missing' && (
            <button className="summary-button" onClick={() => void startSummary(place)}>
              Try again
            </button>
          )}
          <button className="summary-button quiet" onClick={close}>
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="stash-summary" data-testid="stash-summary" data-state="done">
      <span className="stash-summary-text">{result.text}</span>
      <div className="stash-summary-actions">
        {onUse && (
          <button
            className="summary-button"
            data-testid="stash-use-name"
            title="Rename the stash to this line"
            disabled={busy}
            onClick={() => {
              onUse(result.text);
              close();
            }}
          >
            Use as its name
          </button>
        )}
        <button className="summary-button quiet" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}

/** The commit box's sparkle: Claude Code writes the message from the staged changes, or from all of them. */
function MessageSpark({ repoPath, files, onWritten }: { repoPath: string; files: number; onWritten(message: string): void }) {
  const place: SummaryPlace = { key: summaryKey.message(repoPath), request: { kind: 'message', repoPath }, reading: 'Claude Code is writing a commit message…' };
  const running = useSummary(place.key)?.result === null;
  return (
    <SparkButton
      title={files === 0 ? 'Nothing to write a message for' : 'Write a commit message'}
      state={running ? 'running' : 'idle'}
      size={13}
      disabled={files === 0 && !running}
      testId="write-message"
      onClick={() => {
        if (running) return closeSummary(place.key);
        void startSummary(place).then((result) => {
          if (!result?.ok) return;
          onWritten(result.text);
          closeSummary(place.key);
        });
      }}
    />
  );
}

/** Why Claude Code wrote no message, under the commit box. */
function MessageProblem({ repoPath }: { repoPath: string }) {
  const place: SummaryPlace = { key: summaryKey.message(repoPath), request: { kind: 'message', repoPath }, reading: 'Claude Code is writing a commit message…' };
  const run = useSummary(place.key);
  if (!run?.result || run.result.ok) return null;
  return <PlaceCard place={place} label="COMMIT MESSAGE" testId="message-problem" />;
}
