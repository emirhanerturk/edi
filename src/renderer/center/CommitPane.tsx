import { memo, useMemo, useState } from 'react';
import type { CommitFile, CommitResult } from '../../shared/api';
import { ChevronDown, ChevronRight, CopyIcon, ExpandIcon, ExternalIcon, FoldIcon } from '../components/icons';
import { letterColor } from '../git/model';
import type { DiffTokens } from '../highlight/highlight';
import { longAgo, splitSubject } from '../history/time';
import { Code } from './DiffPane';
import { MAX_DIFF_LINES, diffRows } from './diffRows';
import { ViewNote } from './ViewHeader';

/** Diff'i bundan uzun dosya kapalı başlar. */
export const COLLAPSE_LINES = 400;
/** Açık başlayan dosyaların satır toplamı bunu geçince kalanlar kapalı başlar (yüzlerce dosyalı commit). */
export const OPEN_BUDGET = 3000;

const lineCount = (file: CommitFile) => file.diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);

/** Kapalı başlayacak dosyaların yolları. */
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
  /** Commit'in göründüğü branch (reponun geçerli branch'i). */
  branch: string | null;
  /** Yüklenene kadar null. */
  result: CommitResult | null;
  now: number;
  /** Dosya yolu → sözdizimi renkleri. */
  tokens: Map<string, DiffTokens>;
  onCopy(): void;
  /** Commit'in GitHub sayfasını tarayıcıda açar. */
  onOpenUrl(url: string): void;
}

/** Bir commit: başlık, gövde, bilgiler ve değişen her dosyanın diff'i alt alta. */
export function CommitPane({ repoName, branch, result, now, tokens, onCopy, onOpenUrl }: CommitPaneProps) {
  const commitOrNull = result?.ok ? result.commit : null;
  // Kapalı dosyalar burada tutulur: başlıktaki "hepsini aç/kapat" düğmesi de değiştirir.
  // Başka commit'e geçince 400 satırı aşanlar kapalı olarak baştan başlar.
  const initial = useMemo(() => (commitOrNull ? initiallyCollapsed(commitOrNull.files) : new Set<string>()), [commitOrNull]);
  const [changed, setChanged] = useState<{ oid: string; collapsed: Set<string> } | null>(null);
  const collapsed = commitOrNull && changed?.oid === commitOrNull.oid ? changed.collapsed : initial;
  const setCollapsed = (update: (prev: Set<string>) => Set<string>) => {
    if (commitOrNull) setChanged({ oid: commitOrNull.oid, collapsed: update(collapsed) });
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
  const paragraphs = commit.body === '' ? [] : commit.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="center-view commit-view" data-testid="center-view" data-kind="commit">
      <header className="commit-header">
        <h1 className="commit-title">
          {prefix !== '' && <span className="prefix">{prefix}</span>}
          {rest === '' && prefix === '' ? '(no subject)' : rest}
        </h1>
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="commit-body" data-testid="commit-body">
            {paragraph}
          </p>
        ))}
        <div className="commit-meta" data-testid="commit-meta">
          <span
            className="commit-author"
            data-testid="commit-author"
            title={commit.authorEmail ? `${commit.authorName || commit.authorEmail} <${commit.authorEmail}>` : commit.authorName}
          >
            {commit.authorName || commit.authorEmail}
          </span>
          <span aria-hidden="true">·</span>
          <span className="commit-repo">{repoName}</span>
          {branch !== null && <span aria-hidden="true">·</span>}
          {branch !== null && <span className="commit-branch mono">{branch}</span>}
          <span aria-hidden="true">·</span>
          <span>{longAgo(commit.date, now)}</span>
          <div className="spacer" />
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
          <button className="commit-copy" aria-label={`Copy hash ${commit.short}`} title="Copy hash" onClick={onCopy}>
            <span className="mono">{commit.short}</span>
            <CopyIcon size={12} />
          </button>
          {result.webUrl && (
            <button className="commit-copy commit-web" aria-label="Open on GitHub" title={result.webUrl} onClick={() => onOpenUrl(result.webUrl!)}>
              <span>GitHub</span>
              <ExternalIcon size={12} />
            </button>
          )}
        </div>
      </header>
      {commit.tooLarge && <ViewNote>This commit is too large to show line by line. Each file's counts are below.</ViewNote>}
      <CommitFiles files={commit.files} tokens={tokens} countsOnly={commit.tooLarge} collapsed={collapsed} onToggle={(path) =>
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

/** Başlıktaki tek düğme: en az bir dosya açıksa hepsini kapatır, hepsi kapalıysa açar. */
function AllFilesButton({ allCollapsed, onCollapse, onExpand }: { allCollapsed: boolean; onCollapse(): void; onExpand(): void }) {
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
}

function CommitFiles({ files, tokens, countsOnly, collapsed, onToggle }: CommitFilesProps) {
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
        />
      ))}
    </div>
  );
}

/** `open` null: satırlar okunmadı (çok büyük commit), dosya açılamaz; yalnız sayılar. */
// Bir dosya açılıp kapanınca yalnız o bölüm yeniden çizilir (büyük commit'lerde önemli).
const CommitFileSection = memo(function CommitFileSection({
  file,
  open,
  tokens,
  onToggle,
}: {
  file: CommitFile;
  open: boolean | null;
  tokens: DiffTokens | null;
  onToggle(path: string): void;
}) {
  const slash = file.path.lastIndexOf('/');
  const showsLines = !file.diff.binary && (file.diff.hunks.length > 0 || open === null);
  return (
    <section className="commit-file" data-testid="commit-file">
      <button
        className="commit-file-head"
        data-testid="commit-file-head"
        aria-expanded={open ?? undefined}
        onClick={open === null ? undefined : () => onToggle(file.path)}
      >
        {open === null ? <span className="commit-file-spacer" /> : open ? <ChevronDown size={11} strokeWidth={1.9} /> : <ChevronRight size={11} strokeWidth={1.9} />}
        <span className="commit-file-letter" style={{ color: letterColor(file.letter) }}>
          {file.letter}
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
      {open === true && <CommitFileBody file={file} tokens={tokens} />}
    </section>
  );
});

function CommitFileBody({ file, tokens }: { file: CommitFile; tokens: DiffTokens | null }) {
  const rows = useMemo(() => diffRows(file.diff, 'inline'), [file.diff]);
  if (file.diff.binary) return <p className="commit-file-note">Binary file</p>;
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
