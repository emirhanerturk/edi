import type { FileContent } from '../../shared/api';
import { LockIcon } from '../components/icons';
import type { Token } from '../highlight/highlight';
import { languageOf } from '../highlight/languages';
import { Code } from './DiffPane';
import { ViewHeader, ViewNote } from './ViewHeader';

/** Dosyanın satırları; sondaki satır sonu boş bir satır sayılmaz. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function size(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Durum çubuğunda açık dosya için kısa bilgi: dil ve satır sayısı ya da boyut. */
export function fileInfo(path: string, content: FileContent | null): string | null {
  if (!content || !content.ok) return null;
  if (content.kind === 'binary') return `Binary · ${size(content.size)}`;
  const label = languageOf(path)?.label ?? 'Plain Text';
  if (content.kind === 'tooLarge') return `${label} · ${size(content.size)}`;
  const count = splitLines(content.text).length;
  return `${label} · ${count} ${count === 1 ? 'line' : 'lines'}`;
}

export interface FilePaneProps {
  repoName: string;
  path: string;
  /** Yüklenene kadar null. */
  content: FileContent | null;
  /** Git'in henüz izlemediği dosya. */
  isNew: boolean;
  /** Satır başına renkli parçalar; henüz gelmediyse ya da dil bilinmiyorsa null. */
  tokens: Token[][] | null;
  onOpenInZed(): void;
}

/** Salt okunur dosya görünümü. */
export function FilePane({ repoName, path, content, isNew, tokens, onOpenInZed }: FilePaneProps) {
  return (
    <div className="center-view" data-testid="center-view" data-kind="file">
      <ViewHeader repoName={repoName} path={path} onOpenInZed={onOpenInZed}>
        {isNew && <span className="chip chip-new">new file</span>}
        <div className="spacer" />
        <span className="read-only">
          <LockIcon size={12} />
          Read-only
        </span>
      </ViewHeader>
      <FileBody content={content} tokens={tokens} />
    </div>
  );
}

function FileBody({ content, tokens }: { content: FileContent | null; tokens: Token[][] | null }) {
  if (content === null) return <div className="file-body" />;
  if (!content.ok) {
    return content.error === 'File not found' ? <ViewNote>File not found</ViewNote> : <ViewNote alert>{content.error}</ViewNote>;
  }
  if (content.kind === 'tooLarge') return <ViewNote>This file is too large to show ({(content.size / 1_048_576).toFixed(1)} MB)</ViewNote>;
  if (content.kind === 'binary') return <ViewNote>Binary file</ViewNote>;
  const lines = splitLines(content.text);
  if (lines.length === 0) return <ViewNote>Empty file</ViewNote>;
  return (
    <div className="file-body mono" data-testid="file-body">
      {lines.map((line, index) => (
        <div key={index} className="file-line" data-testid="file-line">
          <span className="ln">{index + 1}</span>
          <Code text={line} tokens={tokens?.[index]} />
        </div>
      ))}
    </div>
  );
}
