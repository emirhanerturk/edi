import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import type { CommitSummary } from '../../git/types';
import { ArrowUp, ChevronDown, ChevronRight, TagIcon, WarningIcon } from '../components/icons';
import { useNow } from '../components/useNow';
import { useApp } from '../store';
import { type HistoryRow, type RepoGroup, type RepoLog, byRepo, historyKey, isRelease, timeline } from './model';
import { RepoFilter } from './RepoFilter';
import { longAgo, shortAgo, splitSubject } from './time';
import './history.css';

export type HistoryLayout = 'timeline' | 'byRepo';

export interface HistoryPanelViewProps {
  layout: HistoryLayout;
  rows: HistoryRow[];
  groups: RepoGroup[];
  now: number;
  /** Showing a single repo: repo names are hidden, the branch label is shown. */
  single: boolean;
  /** The repo's branch in single-repo mode. */
  branch: string | null;
  /** Repos in the filter menu. */
  repos: { name: string; path: string }[];
  filter: string | null;
  /** The first logs haven't arrived yet. */
  loading: boolean;
  /** Repos whose log couldn't be read. */
  errors: { repoName: string; error: string }[];
  canLoadMore: boolean;
  /** The commit open in the center panel. */
  selected: { repoPath: string; oid: string } | null;
  onOpenCommit(repoPath: string, oid: string, pin: boolean): void;
  onFilter(path: string | null): void;
  onLayout(layout: HistoryLayout): void;
  onLoadMore(): void;
}

/** Click previews, double click opens a permanent tab, Enter previews. */
function openHandlers(open: (pin: boolean) => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: () => open(false),
    onDoubleClick: () => open(true),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter') open(false);
    },
  } as const;
}

function Subject({ subject, merge = false }: { subject: string; merge?: boolean }) {
  const { prefix, rest } = splitSubject(subject);
  return (
    <span className="history-subject">
      {prefix !== '' && <span className="prefix">{prefix}</span>}
      <span className={merge ? 'merge' : undefined}>{rest === '' && prefix === '' ? '(no subject)' : rest}</span>
    </span>
  );
}

/** History tab: all repos' commits on a single timeline or in repo groups. */
export function HistoryPanelView(props: HistoryPanelViewProps) {
  const { layout, filter, repos, single, branch, errors, canLoadMore, onFilter, onLayout, onLoadMore } = props;
  return (
    <div className="history">
      <div className="history-toolbar">
        <RepoFilter repos={repos} filter={filter} onFilter={onFilter} />
        {single && branch !== null && (
          <span className="history-branch mono" data-testid="history-branch">
            {branch}
          </span>
        )}
        <div className="spacer" />
        <div className="segmented" role="group" aria-label="History layout">
          <button aria-pressed={layout === 'timeline'} onClick={() => onLayout('timeline')}>
            Timeline
          </button>
          <button aria-pressed={layout === 'byRepo'} onClick={() => onLayout('byRepo')}>
            By repo
          </button>
        </div>
      </div>
      <div className="history-list">
        {errors.map(({ repoName, error }) => (
          <div key={repoName} className="history-error" role="alert">
            <WarningIcon size={13} />
            <span>
              <strong>{repoName}</strong> {error}
            </span>
          </div>
        ))}
        {layout === 'timeline' ? <Timeline {...props} /> : <ByRepo {...props} />}
        {canLoadMore && (
          <div className="history-more">
            <button onClick={onLoadMore}>Load 50 more</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ rows, now, single, loading, selected, onOpenCommit }: HistoryPanelViewProps) {
  if (rows.length === 0) return <p className="history-note">{loading ? 'Loading…' : 'No commits yet'}</p>;
  return (
    <>
      {rows.map((row, index) => {
        if (row.type === 'day') {
          return (
            <div key={`day-${index}`} className={`history-day${row.first ? ' first' : ''}`}>
              {row.label}
            </div>
          );
        }
        if (row.type === 'remote') {
          return (
            <div key={`remote-${index}`} className="history-remote mono">
              <span className="rule" />
              <span data-testid="history-remote">{row.upstream}</span>
              <span className="rule" />
            </div>
          );
        }
        const open = (pin: boolean) => onOpenCommit(row.repoPath, row.commit.oid, pin);
        const current = selected?.repoPath === row.repoPath && selected.oid === row.commit.oid;
        if (row.type === 'release') {
          return (
            <div key={row.commit.oid + row.repoPath} className="history-release" data-testid="history-release" aria-current={current} {...openHandlers(open)}>
              <TagIcon size={12} />
              <span className="history-tag mono">{row.tag}</span>
              {!single && <span className="history-repo">{row.repoName}</span>}
              {!single && <span aria-hidden="true">·</span>}
              <span>{shortAgo(row.commit.date, now)}</span>
              <div className="spacer" />
              <span className="history-hash mono">{row.commit.short}</span>
            </div>
          );
        }
        return (
          <div
            key={row.commit.oid + row.repoPath}
            className="history-commit"
            data-testid="history-commit"
            data-merge={row.merge}
            aria-current={current}
            {...openHandlers(open)}
          >
            <div className="history-title">
              <Subject subject={row.commit.subject} merge={row.merge} />
              {row.tag !== null && <span className="history-tag mono">{row.tag}</span>}
              {row.unpushed && <ArrowUp size={12} strokeWidth={1.9} className="history-unpushed" label="Not pushed yet" />}
            </div>
            <div className="history-meta">
              {!single && <span className="history-repo">{row.repoName}</span>}
              {!single && <span aria-hidden="true">·</span>}
              <span>{shortAgo(row.commit.date, now)}</span>
              {row.author !== null && <span aria-hidden="true">·</span>}
              {row.author !== null && <span>{row.author}</span>}
              <div className="spacer" />
              <span className="history-hash mono">{row.commit.short}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function ByRepo({ groups, now, loading, selected, onOpenCommit }: HistoryPanelViewProps) {
  // Groups the user expanded or collapsed; the others are expanded or collapsed based on the last 3 days.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (groups.length === 0) return <p className="history-note">{loading ? 'Loading…' : 'No commits yet'}</p>;
  return (
    <>
      {groups.map((group) => {
        const open = toggled[group.repoPath] ?? group.open;
        return (
          <div key={group.repoPath} className="history-group">
            <button
              className="history-group-head"
              data-testid="history-group"
              aria-expanded={open}
              onClick={() => setToggled((prev) => ({ ...prev, [group.repoPath]: !open }))}
            >
              {open ? <ChevronDown size={11} strokeWidth={1.9} /> : <ChevronRight size={11} strokeWidth={1.9} />}
              <span className={`history-group-name${open ? ' open' : ''}`}>{group.repoName}</span>
              {group.ahead > 0 && <span className="history-sync mono">↑{group.ahead}</span>}
              <div className="spacer" />
              {!open && <span className="history-group-note">{group.latest === null ? 'No commits' : longAgo(group.latest, now)}</span>}
            </button>
            {open &&
              group.commits.map((commit) => (
                <GroupLine
                  key={commit.oid}
                  commit={commit}
                  now={now}
                  current={selected?.repoPath === group.repoPath && selected.oid === commit.oid}
                  open={(pin) => onOpenCommit(group.repoPath, commit.oid, pin)}
                />
              ))}
          </div>
        );
      })}
    </>
  );
}

function GroupLine({ commit, now, current, open }: { commit: CommitSummary; now: number; current: boolean; open(pin: boolean): void }) {
  const release = commit.tags.find((tag) => isRelease(commit.subject, tag));
  return (
    <div className="history-line" data-testid="history-line" aria-current={current} {...openHandlers(open)}>
      {release !== undefined ? (
        <>
          <span className="history-tag mono">{release}</span>
          <div className="spacer" />
        </>
      ) : (
        <Subject subject={commit.subject} merge={commit.parents > 1} />
      )}
      <span className="history-line-when">{shortAgo(commit.date, now)}</span>
    </div>
  );
}

/** The History tab bound to app state. Reads logs when they're shown and whenever HEAD changes. */
export function HistoryPanel() {
  const repos = useApp((s) => s.workspace.repos);
  const history = useApp((s) => s.history);
  const filter = useApp((s) => s.historyFilter);
  const layout = useApp((s) => s.layout.historyLayout);
  const center = useApp((s) => s.center);
  const now = useNow(30_000);
  const { loadHistory, loadMoreHistory, setHistoryFilter, setHistoryLayout, openInCenter } = useApp.getState();

  const shown = useMemo(() => {
    const picked = repos.filter((repo) => repo.path === filter);
    return picked.length > 0 ? picked : repos;
  }, [repos, filter]);

  useEffect(() => {
    for (const repo of shown) {
      if (history[repo.path]?.key !== historyKey(repo)) void loadHistory(repo.path);
    }
  }, [shown, history, loadHistory]);

  const logs: RepoLog[] = [];
  const errors: { repoName: string; error: string }[] = [];
  for (const repo of shown) {
    const log = history[repo.path]?.log;
    if (!log) continue;
    if (log.ok) logs.push({ repo: { name: repo.name, path: repo.path, ahead: repo.status?.ahead ?? 0 }, log });
    else errors.push({ repoName: repo.name, error: log.error });
  }
  const single = shown.length === 1;
  const rows = useMemo(() => timeline(logs, now, { single }), [history, shown, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => byRepo(logs, now), [history, shown, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = center.open ? (center.tabs.find((tab) => tab.id === center.active) ?? null) : null;
  return (
    <HistoryPanelView
      layout={layout}
      rows={rows}
      groups={groups}
      now={now}
      single={single}
      branch={single ? (shown[0]!.status?.head ?? null) : null}
      repos={repos.map((repo) => ({ name: repo.name, path: repo.path }))}
      filter={filter}
      loading={shown.some((repo) => !history[repo.path]?.log)}
      errors={errors}
      canLoadMore={logs.some((log) => log.log.hasMore)}
      selected={active?.kind === 'commit' ? { repoPath: active.repoPath, oid: active.path } : null}
      onOpenCommit={(repoPath, oid, pin) => openInCenter({ kind: 'commit', repoPath, path: oid }, pin)}
      onFilter={setHistoryFilter}
      onLayout={setHistoryLayout}
      onLoadMore={loadMoreHistory}
    />
  );
}
