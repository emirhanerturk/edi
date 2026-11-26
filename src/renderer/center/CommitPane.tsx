import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CommitFile, CommitResult } from '../../shared/api';
import { BranchIcon, CheckIcon, ChevronDown, ChevronRight, CopyIcon, ExpandIcon, ExternalIcon, FileIcon, FoldIcon, MoreIcon } from '../components/icons';
import { letterColor } from '../git/model';
import type { DiffTokens } from '../highlight/highlight';
import { longAgo, splitSubject } from '../history/time';
import { Code } from './DiffPane';
import { MAX_DIFF_LINES, diffRows } from './diffRows';
import type { MediaPair } from './media';
import { MediaCompare } from './MediaCompare';
import { ViewNote } from './ViewHeader';

/** A file with a diff longer than this starts collapsed. */
export const COLLAPSE_LINES = 400;
/** Once the line total of files starting expanded passes this, the rest start collapsed (commits with hundreds of files). */
export const OPEN_BUDGET = 3000;

const lineCount = (file: CommitFile) => file.diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);

/**
 * The body's paragraphs, split at blank lines. Indentation is kept (an indented code sample or a
 * nested list reads as written); only the blank space around a paragraph goes.
 */
export function bodyParagraphs(body: string): string[] {
  return body
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/^(?:[ \t]*\n)+/, '').trimEnd())
    .filter((paragraph) => paragraph !== '');
}

/** Paths of the files that start collapsed. */
export function initiallyCollapsed(files: CommitFile[]): Set<string> {
  const collapsed = new Set<string>();
  let budget = OPEN_BUDGET;
  for (const file of files) {
    const count = lineCount(file);
    if (count > COLLAPSE_LINES || count > budget) collapsed.add(file.path);
    else budget -= count;
  }
  return collapsed;
}

export interface CommitPaneProps {
  repoName: string;
  /** The branch the commit is viewed on (the repo's current branch). */
  branch: string | null;
  /** Null until loaded. */
  result: CommitResult | null;
  now: number;
  /** File path → syntax colors. */
  tokens: Map<string, DiffTokens>;
  onCopy(): void;
  /** Opens the commit's GitHub page in the browser. */
  onOpenUrl(url: string): void;
  /** Opens a changed file (as it is now) in the file view. Must be stable: the file sections are memoized. */
  onOpenFile?(path: string): void;
  /** The ⋯ button: the commit's menu (Revert). No button without it. */
  onMore?(): void;
  /** A changed image or video's versions, shown in place of "Binary file". Must be stable. */
  media?(file: CommitFile): MediaPair | null;
}

/** A commit: subject, body, details and the diff of every changed file, one below the other. */
export function CommitPane({ repoName, branch, result, now, tokens, onCopy, onOpenUrl, onOpenFile, onMore, media }: CommitPaneProps) {
  const commitOrNull = result?.ok ? result.commit : null;
  // Collapsed files are kept here: the "expand/collapse all" button in the header changes them too.
  // Switching to another commit starts over, with those over 400 lines collapsed.
  const initial = useMemo(() => (commitOrNull ? initiallyCollapsed(commitOrNull.files) : new Set<string>()), [commitOrNull]);
  const [changed, setChanged] = useState<{ oid: string; collapsed: Set<string> } | null>(null);
  const collapsed = commitOrNull && changed?.oid === commitOrNull.oid ? changed.collapsed : initial;
  const setCollapsed = (update: (prev: Set<string>) => Set<string>) => {
    if (commitOrNull) setChanged({ oid: commitOrNull.oid, collapsed: update(collapsed) });
  };

  // After a copy the icon is a green check for a moment; switching commits shows the copy icon again.
  const [copiedOid, setCopiedOid] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const copy = (oid: string) => {
    onCopy();
    setCopiedOid(oid);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedOid(null), 1500);
  };

  if (result === null) return <div className="center-view" data-testid="center-view" data-kind="commit" />;
  if (!result.ok) {
    return (
      <div className="center-view" data-testid="center-view" data-kind="commit">
        <ViewNote alert>{result.error}</ViewNote>
      </div>
    );
  }
  const { commit } = result;
  const { prefix, rest } = splitSubject(commit.subject);
  const paragraphs = bodyParagraphs(commit.body);
  return (
    <div className="center-view commit-view" data-testid="center-view" data-kind="commit">
      <header className="commit-header">
        <h1 className="commit-title">
          {prefix !== '' && <span className="prefix">{prefix}</span>}
          {rest === '' && prefix === '' ? '(no subject)' : rest}
        </h1>
        {paragraphs.length > 0 && <CommitBody key={commit.oid} paragraphs={paragraphs} />}
        {/* Two groups: when they don't fit on one line, the counts and buttons move to a second one. */}
        <div className="commit-meta" data-testid="commit-meta">
          <div className="commit-meta-info">
            <span
              className="commit-author"
              data-testid="commit-author"
              title={commit.authorEmail ? `${commit.authorName || commit.authorEmail} <${commit.authorEmail}>` : commit.authorName}
            >
              {commit.authorName || commit.authorEmail}
            </span>
            <span aria-hidden="true">·</span>
            <span className="commit-repo" title={repoName}>
              {repoName}
            </span>
            {branch !== null && <span aria-hidden="true">·</span>}
            {branch !== null && (
              <span className="commit-branch mono" title={branch}>
                <BranchIcon size={11} />
                <span className="commit-branch-name">{branch}</span>
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span className="commit-when">{longAgo(commit.date, now)}</span>
          </div>
          <div className="commit-meta-actions">
            <span className="mono">
              <span className="add">+{commit.added}</span> <span className="del">−{commit.removed}</span>
            </span>
            {!commit.tooLarge && commit.files.length > 0 && (
              <AllFilesButton
                allCollapsed={commit.files.every((file) => collapsed.has(file.path))}
                onCollapse={() => setCollapsed(() => new Set(commit.files.map((file) => file.path)))}
                onExpand={() => setCollapsed(() => new Set())}
              />
            )}
            <button
              className="commit-copy"
              data-copied={copiedOid === commit.oid}
              aria-label={`Copy hash ${commit.short}`}
              title={copiedOid === commit.oid ? 'Copied' : 'Copy hash'}
              onClick={() => copy(commit.oid)}
            >
              <span className="mono">{commit.short}</span>
              {copiedOid === commit.oid ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
            {result.webUrl && (
              <button className="commit-copy commit-web" aria-label="Open on GitHub" title={result.webUrl} onClick={() => onOpenUrl(result.webUrl!)}>
                <span>GitHub</span>
                <ExternalIcon size={12} />
              </button>
            )}
            {onMore && (
              <button className="commit-copy commit-more" data-testid="commit-more" aria-label="More actions" title="More actions" onClick={onMore}>
                <MoreIcon size={12} />
              </button>
            )}
          </div>
        </div>
      </header>
      {commit.tooLarge && <ViewNote>This commit is too large to show line by line. Each file's counts are below.</ViewNote>}
      <CommitFiles files={commit.files} tokens={tokens} countsOnly={commit.tooLarge} collapsed={collapsed} onOpenFile={onOpenFile} media={media} onToggle={(path) =>
          setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          })
        }
      />
    </div>
  );
}

/** The single header button: collapses all if at least one file is expanded, expands all if all are collapsed. */
/** A body this many lines tall or shorter shows whole; a longer one is cut to `FOLD_LINES` lines at first. */
export const FOLD_AFTER_LINES = 4;
export const FOLD_LINES = 3;

/**
 * The body's paragraphs. A long one shows its first lines fading out; a click on it, or on Show more,
 * opens the rest. A click that ends a text selection doesn't. A new commit starts folded again (keyed by oid).
 */
function CommitBody({ paragraphs }: { paragraphs: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);

  // Measured, not counted: how many lines a paragraph takes depends on the view's width.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 19;
      setLong(element.scrollHeight > lineHeight * FOLD_AFTER_LINES + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [paragraphs]);

  const folded = long && !open;
  return (
    <>
      <div
        ref={ref}
        className="commit-text"
        data-testid="commit-text"
        data-folded={folded}
        onClick={() => {
          if (folded && (window.getSelection()?.isCollapsed ?? true)) setOpen(true);
        }}
      >
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="commit-body" data-testid="commit-body">
            {paragraph}
          </p>
        ))}
      </div>
      {long && (
        <button className="commit-text-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

export function AllFilesButton({ allCollapsed, onCollapse, onExpand }: { allCollapsed: boolean; onCollapse(): void; onExpand(): void }) {
  const label = allCollapsed ? 'Expand all files' : 'Collapse all files';
  return (
    <button className="commit-copy commit-fold" aria-label={label} title={label} onClick={allCollapsed ? onExpand : onCollapse}>
      {allCollapsed ? <ExpandIcon size={13} /> : <FoldIcon size={13} />}
    </button>
  );
}

interface CommitFilesProps {
  files: CommitFile[];
  tokens: Map<string, DiffTokens>;
  countsOnly: boolean;
  collapsed: Set<string>;
  onToggle(path: string): void;
  onOpenFile?(path: string): void;
  /** A changed image or video's versions (see `CommitPaneProps.media`). */
  media?(file: CommitFile): MediaPair | null;
}

/** Every changed file's diff, one below the other (the commit and stash views). */
export function CommitFiles({ files, tokens, countsOnly, collapsed, onToggle, onOpenFile, media }: CommitFilesProps) {
  if (files.length === 0) return <ViewNote>No file changes</ViewNote>;
  return (
    <div className="commit-files mono">
      {files.map((file) => (
        <CommitFileSection
          key={file.path}
          file={file}
          open={countsOnly ? null : !collapsed.has(file.path)}
          tokens={tokens.get(file.path) ?? null}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          media={media}
        />
      ))}
    </div>
  );
}

/** `open` null: lines weren't read (commit too large), the file can't be expanded; only the counts. */
// Expanding or collapsing a file rerenders only that section (matters for large commits).
const CommitFileSection = memo(function CommitFileSection({
  file,
  open,
  tokens,
  onToggle,
  onOpenFile,
  media,
}: {
  file: CommitFile;
  open: boolean | null;
  tokens: DiffTokens | null;
  onToggle(path: string): void;
  onOpenFile?(path: string): void;
  media?(file: CommitFile): MediaPair | null;
}) {
  const slash = file.path.lastIndexOf('/');
  const showsLines = !file.diff.binary && (file.diff.hunks.length > 0 || open === null);
  // A stash's new file was untracked and comes back untracked: `?`, as in the Git tab.
  const mark = file.untracked ? '?' : file.letter;
  return (
    <section className="commit-file" data-testid="commit-file">
      <div className="commit-file-bar">
        <button
          className="commit-file-head"
          data-testid="commit-file-head"
          aria-expanded={open ?? undefined}
          onClick={open === null ? undefined : () => onToggle(file.path)}
        >
          {open === null ? <span className="commit-file-spacer" /> : open ? <ChevronDown size={11} strokeWidth={1.9} /> : <ChevronRight size={11} strokeWidth={1.9} />}
          <span className="commit-file-letter" style={{ color: letterColor(mark) }} title={file.untracked ? 'New file' : undefined}>
            {mark}
          </span>
          <span className="commit-file-path">
            {slash !== -1 && file.path.slice(0, slash + 1)}
            <span className="commit-file-name">{file.path.slice(slash + 1)}</span>
          </span>
          {file.origPath !== null && showsLines && open !== null && <span className="commit-file-from">← {file.origPath}</span>}
          <div className="spacer" />
          {showsLines && (
            <span>
              {file.diff.added > 0 && <span className="add">+{file.diff.added}</span>}
              {file.diff.added > 0 && file.diff.removed > 0 && ' '}
              {file.diff.removed > 0 && <span className="del">−{file.diff.removed}</span>}
            </span>
          )}
        </button>
        {/* A file the commit deleted may not be there any more. */}
        {onOpenFile && file.letter !== 'D' && (
          <button className="icon-button tiny commit-file-open" aria-label={`Open ${file.path.slice(slash + 1)}`} title="Open file" onClick={() => onOpenFile(file.path)}>
            <FileIcon size={12} />
          </button>
        )}
      </div>
      {open === true && <CommitFileBody file={file} tokens={tokens} media={media} />}
    </section>
  );
});

function CommitFileBody({ file, tokens, media }: { file: CommitFile; tokens: DiffTokens | null; media?(file: CommitFile): MediaPair | null }) {
  const rows = useMemo(() => diffRows(file.diff, 'inline'), [file.diff]);
  if (file.diff.binary) {
    const pair = media?.(file) ?? null;
    return pair ? <MediaCompare pair={pair} /> : <p className="commit-file-note">Binary file</p>;
  }
  if (file.diff.hunks.length === 0) {
    return (
      <p className="commit-file-note">
        No content changes
        {file.origPath !== null && <span className="view-note-detail"> · Renamed from {file.origPath}</span>}
      </p>
    );
  }
  return (
    <div className="diff-body inline commit-diff">
      {rows.rows.map((row, index) =>
        row.type === 'hunk' ? (
          <div key={index} className="diff-hunk">
            {row.text}
          </div>
        ) : row.type === 'inline' ? (
          <div key={index} className="diff-row" data-testid="diff-row" data-kind={row.kind}>
            <span className="ln">{row.oldNo}</span>
            <span className="ln">{row.newNo}</span>
            <span className="mark">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
            <Code text={row.text} tokens={row.kind === 'add' ? tokens?.new.get(row.newNo!) : tokens?.old.get(row.oldNo!)} />
          </div>
        ) : null,
      )}
      {rows.truncated && (
        <p className="diff-truncated">This file's diff is long: only the first {MAX_DIFF_LINES.toLocaleString('en-US')} lines are shown.</p>
      )}
    </div>
  );
}
