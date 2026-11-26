import type { KeyboardEvent } from 'react';
import type { FileHistoryEntry, FileHistoryResult } from '../../shared/api';
import type { EditorId } from '../../shared/editors';
import type { ParsedDiff } from '../../git/diffParse';
import { CheckIcon, CommitIcon, CopyIcon, FileIcon } from '../components/icons';
import type { DiffTokens } from '../highlight/highlight';
import { longAgo, shortAgo, splitSubject } from '../history/time';
import { DiffBody } from './DiffPane';
import { ViewHeader, ViewNote } from './ViewHeader';

/** The key of the row for the file's changes not committed yet. */
export const UNCOMMITTED = 'uncommitted';

export type FileChangeView = { ok: true; diff: ParsedDiff } | { ok: false; error: string };

export interface FileHistoryPaneProps {
  repoName: string;
  /** The file's path now. */
  path: string;
  /** Null until loaded. */
  history: FileHistoryResult | null;
  /** The file has changes not committed yet: a first row shows them. */
  uncommitted: boolean;
  /** The selected row: a commit id, or `UNCOMMITTED`. */
  selected: string | null;
  onSelect(key: string): void;
  /** The selected row's change to the file; null while it loads. */
  change: FileChangeView | null;
  tokens: DiffTokens | null;
  now: number;
  /** The hash just copied, for a moment. */
  copied: string | null;
  canLoadMore: boolean;
  onLoadMore(): void;
  onOpenFile(): void;
  onOpenIn(editor: EditorId): void;
  onOpenCommit(oid: string): void;
  onOpenChanges(): void;
  onCopy(oid: string): void;
}

function Subject({ subject }: { subject: string }) {
  const { prefix, rest } = splitSubject(subject);
  return (
    <>
      {prefix !== '' && <span className="prefix">{prefix}</span>}
      {rest === '' && prefix === '' ? '(no subject)' : rest}
    </>
  );
}

const counts = (added: number, removed: number) => (
  <>
    {added > 0 && <span className="add">+{added}</span>}
    {added > 0 && removed > 0 && ' '}
    {removed > 0 && <span className="del">−{removed}</span>}
  </>
);

/** Up and Down move along the rows, as in a list. */
function rowKeys(event: KeyboardEvent<HTMLButtonElement>, onSelect: (key: string) => void) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const rows = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])];
  const next = rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  next.focus();
  onSelect(next.dataset.row!);
}

/** A file's history: the commits that changed it on top, the selected one's change to the file below. */
export function FileHistoryPane(props: FileHistoryPaneProps) {
  const { history, uncommitted, selected, onSelect, change, now } = props;
  const entries = history?.ok ? history.entries : [];
  const keys = [...(uncommitted ? [UNCOMMITTED] : []), ...entries.map((entry) => entry.commit.oid)];
  const entry = entries.find((candidate) => candidate.commit.oid === selected) ?? null;
  const count = entries.length;

  const row = (key: string, index: number, body: React.ReactNode, extraClass = '') => (
    <button
      key={key}
      className={`file-history-row${extraClass}`}
      data-testid="file-history-row"
      data-row={key}
      role="option"
      aria-selected={key === selected}
      tabIndex={key === selected ? 0 : -1}
      onClick={() => onSelect(key)}
      onKeyDown={(event) => rowKeys(event, onSelect)}
    >
      <span className={`file-history-rail${index === 0 ? ' first' : ''}${index === keys.length - 1 ? ' last' : ''}`} aria-hidden="true" />
      <span className={`file-history-dot${key === UNCOMMITTED ? ' uncommitted' : ''}`} aria-hidden="true" />
      {body}
    </button>
  );

  return (
    <div className="center-view file-history" data-testid="center-view" data-kind="history">
      <ViewHeader repoName={props.repoName} path={props.path} onOpenIn={props.onOpenIn}>
        {history?.ok && (
          <span className="chip" data-testid="file-history-count">
            {count}
            {history.hasMore ? '+' : ''} {count === 1 && !history.hasMore ? 'commit' : 'commits'}
          </span>
        )}
        <div className="spacer" />
        <button className="view-button" title="Show the whole file" onClick={props.onOpenFile}>
          <FileIcon size={12} />
          <span>Open file</span>
        </button>
      </ViewHeader>
      {history === null ? (
        <div className="file-history-list" />
      ) : !history.ok ? (
        <ViewNote alert>{history.error}</ViewNote>
      ) : keys.length === 0 ? (
        <ViewNote>No commit has this file yet</ViewNote>
      ) : (
        <>
          <div className="file-history-list" role="listbox" aria-label={`History of ${props.path}`}>
            {uncommitted &&
              row(
                UNCOMMITTED,
                0,
                <>
                  <span className="file-history-subject">Uncommitted changes</span>
                  <span className="file-history-when">now</span>
                  <span className="file-history-hash" />
                </>,
                ' uncommitted',
              )}
            {entries.map((item, at) => {
              const index = at + (uncommitted ? 1 : 0);
              return [
                row(
                  item.commit.oid,
                  index,
                  <>
                    <span className="file-history-subject">
                      <Subject subject={item.commit.subject} />
                    </span>
                    <span className="file-history-counts mono">{item.binary ? 'binary' : counts(item.added, item.removed)}</span>
                    <span className="file-history-author" title={item.commit.authorEmail}>
                      {item.commit.authorName}
                    </span>
                    <span className="file-history-when">{shortAgo(item.commit.date, now)}</span>
                    <span className="file-history-hash mono">{item.commit.short}</span>
                  </>,
                ),
                item.origPath !== null && (
                  <div key={`${item.commit.oid}:renamed`} className="file-history-rename" data-testid="file-history-rename">
                    <span className="file-history-rail" aria-hidden="true" />
                    <span className="rule" />
                    <span>
                      renamed from <span className="mono">{item.origPath}</span>
                    </span>
                    <span className="rule" />
                  </div>
                ),
              ];
            })}
            {props.canLoadMore && (
              <div className="file-history-more">
                <button onClick={props.onLoadMore}>Load 50 more</button>
              </div>
            )}
          </div>
          <Detail {...props} entry={entry} />
          <div className="file-history-change">
            {change === null ? null : !change.ok ? (
              <ViewNote alert>{change.error}</ViewNote>
            ) : change.diff.binary ? (
              <ViewNote>Binary file</ViewNote>
            ) : change.diff.hunks.length === 0 ? (
              <ViewNote>{entry?.origPath ? `Renamed from ${entry.origPath}, no content changes` : 'No content changes'}</ViewNote>
            ) : (
              <DiffBody diff={change.diff} mode="inline" tokens={props.tokens} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The selected row: its subject, who made it and when, its counts, its hash, and the way to the whole commit. */
function Detail({ selected, entry, change, now, copied, onCopy, onOpenCommit, onOpenChanges }: FileHistoryPaneProps & { entry: FileHistoryEntry | null }) {
  if (selected === UNCOMMITTED) {
    const diff = change?.ok ? change.diff : null;
    return (
      <div className="file-history-detail" data-testid="file-history-detail">
        <div className="file-history-detail-text">
          <span className="file-history-detail-subject uncommitted">Uncommitted changes</span>
          <span className="file-history-detail-meta">Not committed yet · against HEAD</span>
        </div>
        {diff && <span className="mono file-history-detail-counts">{counts(diff.added, diff.removed)}</span>}
        <button className="view-button" onClick={onOpenChanges}>
          <span>Open changes</span>
        </button>
      </div>
    );
  }
  if (!entry) return null;
  const { commit } = entry;
  return (
    <div className="file-history-detail" data-testid="file-history-detail">
      <div className="file-history-detail-text">
        <span className="file-history-detail-subject">
          <Subject subject={commit.subject} />
        </span>
        <span className="file-history-detail-meta">
          {commit.authorName} · {longAgo(commit.date, now)}
        </span>
      </div>
      {!entry.binary && <span className="mono file-history-detail-counts">{counts(entry.added, entry.removed)}</span>}
      <button className="commit-copy" data-copied={copied === commit.oid} aria-label={`Copy hash ${commit.short}`} title={copied === commit.oid ? 'Copied' : 'Copy hash'} onClick={() => onCopy(commit.oid)}>
        <span className="mono">{commit.short}</span>
        {copied === commit.oid ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      </button>
      <button className="view-button" onClick={() => onOpenCommit(commit.oid)}>
        <CommitIcon size={12} />
        <span>Open commit</span>
      </button>
    </div>
  );
}
