import { memo, useMemo } from 'react';
import type { ParsedDiff } from '../../git/diffParse';
import type { DiffView } from '../../shared/api';
import type { DiffTokens, Token } from '../highlight/highlight';
import { ViewHeader, ViewNote } from './ViewHeader';
import { type Cell, MAX_DIFF_LINES, type Row, diffRows } from './diffRows';

export interface DiffPaneProps {
  repoName: string;
  path: string;
  /** Yüklenene kadar null. */
  view: DiffView | null;
  mode: 'split' | 'inline';
  /** Sözdizimi renkleri; henüz gelmediyse ya da dil bilinmiyorsa null. */
  tokens: DiffTokens | null;
  onMode(mode: 'split' | 'inline'): void;
  onOpenInZed(): void;
}

const NOT_CHANGED = 'File is not in the list of changes';

/** Bir dosyanın HEAD'e göre değişikliği: yan yana ya da tek sütun. */
export function DiffPane({ repoName, path, view, mode, tokens, onMode, onOpenInZed }: DiffPaneProps) {
  const diff = view?.ok ? view.diff : null;
  const showsLines = diff !== null && !diff.binary && diff.hunks.length > 0;

  return (
    <div className="center-view" data-testid="center-view" data-kind="diff">
      <ViewHeader repoName={repoName} path={path} onOpenInZed={onOpenInZed}>
        {showsLines && (
          <span className="mono view-counts">
            <span className="add">+{diff.added}</span> <span className="del">−{diff.removed}</span>
          </span>
        )}
        <div className="spacer" />
        {showsLines && (
          <div className="segmented" role="group" aria-label="Diff view">
            <button aria-pressed={mode === 'split'} onClick={() => onMode('split')}>
              Split
            </button>
            <button aria-pressed={mode === 'inline'} onClick={() => onMode('inline')}>
              Inline
            </button>
          </div>
        )}
      </ViewHeader>
      {view === null ? (
        <div className="diff-body" />
      ) : !view.ok ? (
        view.error === NOT_CHANGED ? (
          <ViewNote>No changes left in this file</ViewNote>
        ) : (
          <ViewNote alert>{view.error}</ViewNote>
        )
      ) : view.diff.binary ? (
        <ViewNote>Binary file — no diff to show</ViewNote>
      ) : view.diff.hunks.length === 0 ? (
        <ViewNote>
          No content changes
          {view.file.origPath !== null && <span className="view-note-detail"> · Renamed from {view.file.origPath}</span>}
        </ViewNote>
      ) : (
        <DiffBody diff={view.diff} mode={mode} tokens={tokens} />
      )}
    </div>
  );
}

/**
 * Yoklama her 2 sn'de bağlı görünümü yeniden çizer; diff, mod ve renkler aynı kaldıkça
 * (useView aynı veride aynı nesneyi tutar) satırlar yeniden kurulmaz, gövde yeniden çizilmez.
 */
const DiffBody = memo(function DiffBody({ diff, mode, tokens }: { diff: ParsedDiff; mode: 'split' | 'inline'; tokens: DiffTokens | null }) {
  const rows = useMemo(() => diffRows(diff, mode), [diff, mode]);
  return (
    <div className={`diff-body mono ${mode}`} data-testid="diff-body">
      {mode === 'split' && (
        <div className="diff-sides">
          <span>HEAD</span>
          <span>WORKING TREE</span>
        </div>
      )}
      {rows.rows.map((row, index) =>
        row.type === 'hunk' ? (
          <div key={index} className="diff-hunk">
            {row.text}
          </div>
        ) : row.type === 'split' ? (
          <div key={index} className="diff-row" data-testid="diff-row">
            <SplitCell side="old" cell={row.left} tokens={tokens} />
            <SplitCell side="new" cell={row.right} tokens={tokens} />
          </div>
        ) : (
          <div key={index} className="diff-row" data-testid="diff-row" data-kind={row.kind}>
            <span className="ln">{row.oldNo}</span>
            <span className="ln">{row.newNo}</span>
            <span className="mark">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
            <Code text={row.text} tokens={row.kind === 'add' ? tokens?.new.get(row.newNo!) : tokens?.old.get(row.oldNo!)} />
          </div>
        ),
      )}
      {rows.truncated && (
        <p className="diff-truncated">
          This diff is long: only the first {MAX_DIFF_LINES.toLocaleString('en-US')} lines are shown. Open the file in Zed to see the rest.
        </p>
      )}
    </div>
  );
});

function SplitCell({ side, cell, tokens }: { side: 'old' | 'new'; cell: Cell | null; tokens: DiffTokens | null }) {
  if (!cell) return <div className="diff-cell" data-side={side} data-kind="empty" />;
  return (
    <div className="diff-cell" data-side={side} data-kind={cell.kind}>
      <span className="ln">{cell.no}</span>
      <span className="mark">{cell.kind === 'add' ? '+' : cell.kind === 'del' ? '−' : ''}</span>
      <Code text={cell.text} tokens={(side === 'old' ? tokens?.old : tokens?.new)?.get(cell.no)} />
    </div>
  );
}

/**
 * Satır metni. Renkler ancak metinle birebir örtüşüyorsa kullanılır: dosya değişti de yeni
 * renkler henüz gelmediyse eski satırın renkleri yeni metnin üstüne yazılmaz.
 */
export function Code({ text, tokens }: { text: string; tokens: Token[] | undefined }) {
  const usable = tokens !== undefined && tokens.map((token) => token.text).join('') === text;
  return (
    <span className="code">
      {usable
        ? tokens.map((token, index) => (
            <span key={index} style={{ color: token.color }}>
              {token.text}
            </span>
          ))
        : text}
    </span>
  );
}
