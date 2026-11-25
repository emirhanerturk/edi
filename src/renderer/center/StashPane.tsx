import { ArchiveArrowUp, ArchiveX, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StashMenuAction, StashResult } from '../../shared/api';
import { BranchIcon, CheckIcon, CopyIcon } from '../components/icons';
import { stashTitle } from '../git/model';
import type { DiffTokens } from '../highlight/highlight';
import { longAgo } from '../history/time';
import { AllFilesButton, CommitFiles, initiallyCollapsed } from './CommitPane';
import { ViewNote } from './ViewHeader';

export interface StashPaneProps {
  repoName: string;
  /** Null until loaded. */
  result: StashResult | null;
  now: number;
  /** File path → syntax colors. */
  tokens: Map<string, DiffTokens>;
  /** The repo's running operation ("Popping stash…"); null if none. */
  busy: string | null;
  /** No conflict in the repo: git can pop or apply. */
  canApply: boolean;
  onAction(action: StashMenuAction): void;
  /** A new message was typed for the stash. */
  onRename(message: string): void;
  onCopy(): void;
}

/** A stash: its message, where it was made, Pop / Apply / Rename / Drop, and the diff of every file in it. */
export function StashPane({ repoName, result, now, tokens, busy, canApply, onAction, onRename, onCopy }: StashPaneProps) {
  const stash = result?.ok ? result.stash : null;
  // As in the commit view: large files start collapsed, and the header button folds or unfolds them all.
  const initial = useMemo(() => (stash ? initiallyCollapsed(stash.files) : new Set<string>()), [stash]);
  const [changed, setChanged] = useState<{ oid: string; collapsed: Set<string> } | null>(null);
  const collapsed = stash && changed?.oid === stash.entry.oid ? changed.collapsed : initial;
  const setCollapsed = (update: (prev: Set<string>) => Set<string>) => {
    if (stash) setChanged({ oid: stash.entry.oid, collapsed: update(collapsed) });
  };

  // The stash whose name is being typed; another stash opened in the view ends it.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  if (result === null) return <div className="center-view" data-testid="center-view" data-kind="stash" />;
  if (!result.ok) {
    return (
      <div className="center-view" data-testid="center-view" data-kind="stash">
        {result.gone ? <ViewNote>This stash is no longer in the list: it was popped or dropped.</ViewNote> : <ViewNote alert>{result.error}</ViewNote>}
      </div>
    );
  }
  const { entry, files } = result.stash;
  const applyTitle = canApply ? undefined : 'Resolve the conflicts first';
  return (
    <div className="center-view commit-view" data-testid="center-view" data-kind="stash">
      <header className="commit-header">
        {renaming === entry.oid ? (
          <StashNameInput
            initial={stashTitle(entry)}
            onSubmit={(message) => {
              setRenaming(null);
              if (message !== stashTitle(entry)) onRename(message);
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <h1 className="commit-title" data-testid="stash-title">
            {stashTitle(entry)}
          </h1>
        )}
        <div className="commit-meta" data-testid="stash-meta">
          <div className="commit-meta-info">
            {entry.branch !== null && (
              <span className="commit-branch mono" title={`Stashed on ${entry.branch}`}>
                <BranchIcon size={11} />
                <span className="commit-branch-name">{entry.branch}</span>
              </span>
            )}
            {entry.branch !== null && <span aria-hidden="true">·</span>}
            <span className="commit-repo" title={repoName}>
              {repoName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="commit-when">{longAgo(entry.date, now)}</span>
          </div>
          <div className="commit-meta-actions">
            <span className="mono">
              <span className="add">+{result.stash.added}</span> <span className="del">−{result.stash.removed}</span>
            </span>
            {!result.stash.tooLarge && files.length > 0 && (
              <AllFilesButton
                allCollapsed={files.every((file) => collapsed.has(file.path))}
                onCollapse={() => setCollapsed(() => new Set(files.map((file) => file.path)))}
                onExpand={() => setCollapsed(() => new Set())}
              />
            )}
            <button
              className="commit-copy"
              data-copied={copied}
              aria-label={`Copy hash ${result.stash.short}`}
              title={copied ? 'Copied' : 'Copy hash'}
              onClick={() => {
                onCopy();
                setCopied(true);
                clearTimeout(copiedTimer.current);
                copiedTimer.current = setTimeout(() => setCopied(false), 1500);
              }}
            >
              <span className="mono">{result.stash.short}</span>
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          </div>
        </div>
        <div className="stash-actions">
          <button
            className="stash-action primary"
            data-testid="stash-view-pop"
            title={applyTitle ?? 'Bring the changes back and remove the stash'}
            disabled={busy !== null || !canApply}
            onClick={() => onAction('pop')}
          >
            <ArchiveArrowUp size={13} strokeWidth={1.9} />
            <span>Pop</span>
          </button>
          <button
            className="stash-action"
            data-testid="stash-view-apply"
            title={applyTitle ?? 'Bring the changes back and keep the stash'}
            disabled={busy !== null || !canApply}
            onClick={() => onAction('apply')}
          >
            <span>Apply</span>
          </button>
          <button
            className="stash-action"
            data-testid="stash-view-rename"
            title="Give the stash a new message"
            disabled={busy !== null}
            onClick={() => setRenaming(entry.oid)}
          >
            <Pencil size={12} strokeWidth={1.9} />
            <span>Rename</span>
          </button>
          <button className="stash-action danger" data-testid="stash-view-drop" title="Delete the stash" disabled={busy !== null} onClick={() => onAction('drop')}>
            <ArchiveX size={13} strokeWidth={1.8} />
            <span>Drop…</span>
          </button>
          {busy !== null && <span className="stash-busy">{busy}</span>}
        </div>
      </header>
      {result.stash.tooLarge && <ViewNote>This stash is too large to show line by line. Each file's counts are below.</ViewNote>}
      <CommitFiles
        files={files}
        tokens={tokens}
        countsOnly={result.stash.tooLarge}
        collapsed={collapsed}
        onToggle={(path) =>
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

/** The stash's name, typed in place of the title: Enter saves, Escape or clicking away cancels. */
function StashNameInput({ initial, onSubmit, onCancel }: { initial: string; onSubmit(message: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <input
      ref={input}
      className="stash-name-input"
      data-testid="stash-name-input"
      aria-label="Stash name"
      value={value}
      maxLength={200}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const message = value.trim();
          if (message !== '') onSubmit(message);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
    />
  );
}
