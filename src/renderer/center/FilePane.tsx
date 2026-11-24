import { memo, useMemo, useState } from 'react';
import type { FileContent } from '../../shared/api';
import { mediaUrl } from '../../shared/media';
import { LockIcon } from '../components/icons';
import type { Token } from '../highlight/highlight';
import { languageOf } from '../highlight/languages';
import { Code } from './DiffPane';
import { splitLines } from './lines';
import { ViewHeader, ViewNote } from './ViewHeader';

export { splitLines };

function size(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Durum çubuğunda açık dosya için kısa bilgi: dil ve satır sayısı ya da boyut. */
export function fileInfo(path: string, content: FileContent | null): string | null {
  if (!content || !content.ok) return null;
  if (content.kind === 'binary') return `Binary · ${size(content.size)}`;
  if (content.kind === 'media') {
    const ext = path.slice(path.lastIndexOf('.') + 1).toUpperCase();
    return `${ext} ${content.media} · ${size(content.size)}`;
  }
  const label = languageOf(path)?.label ?? 'Plain Text';
  if (content.kind === 'tooLarge') return `${label} · ${size(content.size)}`;
  const count = splitLines(content.text).length;
  return `${label} · ${count} ${count === 1 ? 'line' : 'lines'}`;
}

export interface FilePaneProps {
  repoName: string;
  /** Görsel ve videonun adresi için. */
  repoPath: string;
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
export function FilePane({ repoName, repoPath, path, content, isNew, tokens, onOpenInZed }: FilePaneProps) {
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
      {content?.ok && content.kind === 'media' ? (
        <MediaBody key={`${repoPath}\n${path}`} src={mediaUrl(repoPath, path, content.mtime)} media={content.media} name={path.slice(path.lastIndexOf('/') + 1)} />
      ) : (
        <FileBody content={content} tokens={tokens} />
      )}
    </div>
  );
}

/** Görsel ya da video, ana sürecin `edi-media://` adresinden; açılamazsa not. */
function MediaBody({ src, media, name }: { src: string; media: 'image' | 'video'; name: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <ViewNote>{media === 'image' ? 'This image could not be shown' : 'This video could not be played'}</ViewNote>;
  return (
    <div className="media-body" data-testid="media-body">
      {media === 'image' ? (
        <img className="media-image" src={src} alt={name} draggable={false} onError={() => setFailed(src)} />
      ) : (
        <video className="media-video" src={src} controls preload="metadata" onError={() => setFailed(src)} />
      )}
    </div>
  );
}

/**
 * Yoklama her 2 sn'de bağlı görünümü yeniden çizer; içerik ve renkler aynı nesne kaldıkça
 * (useView aynı veride aynı nesneyi tutar) bu gövde yeniden çizilmez.
 */
const FileBody = memo(function FileBody({ content, tokens }: { content: FileContent | null; tokens: Token[][] | null }) {
  const text = content?.ok && content.kind === 'text' ? content.text : null;
  const lines = useMemo(() => (text === null ? [] : splitLines(text)), [text]);
  if (content === null) return <div className="file-body" />;
  if (!content.ok) {
    return content.error === 'File not found' ? <ViewNote>File not found</ViewNote> : <ViewNote alert>{content.error}</ViewNote>;
  }
  if (content.kind === 'tooLarge') return <ViewNote>This file is too large to show ({(content.size / 1_048_576).toFixed(1)} MB)</ViewNote>;
  if (content.kind === 'binary') return <ViewNote>Binary file</ViewNote>;
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
});
