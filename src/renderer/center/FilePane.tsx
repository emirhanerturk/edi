import type { EditorId } from '../../shared/editors';
import { type ReactNode, memo, useMemo, useState } from 'react';
import type { FileContent } from '../../shared/api';
import { mediaUrl } from '../../shared/media';
import { fileSize } from '../format';
import { HistoryIcon, LockIcon } from '../components/icons';
import type { Token } from '../highlight/highlight';
import { languageOf } from '../highlight/languages';
import { Code } from './DiffPane';
import type { EditState } from './editSession';
import { splitLines } from './lines';
import { ViewHeader, ViewNote } from './ViewHeader';

export { splitLines };

const size = fileSize;

/** Short status bar info for the open file: language and line count, or size. */
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
  /** For the image and video URL. */
  repoPath: string;
  path: string;
  /** Null until loaded. */
  content: FileContent | null;
  /** A file git doesn't track yet. */
  isNew: boolean;
  /** Colored tokens per line; null if they haven't arrived yet or the language is unknown. */
  tokens: Token[][] | null;
  onOpenIn(editor: EditorId): void;
  /** The code editor, once Monaco has loaded for this file; until then the read-only lines show. */
  editor?: ReactNode;
  edit?: EditState | null;
  onSave?(): void;
  onKeepMine?(): void;
  onLoadDisk?(): void;
  /** Closes the tab (offered when the file was deleted under unsaved edits). */
  onClose?(): void;
  /** The History button: the file's history in a tab. */
  onHistory?(): void;
}

/** The file view: an editor for text files, a preview for images and videos, a note otherwise. */
export function FilePane(props: FilePaneProps) {
  const { repoName, repoPath, path, content, isNew, tokens, onOpenIn, editor, edit } = props;
  const isText = content?.ok === true && content.kind === 'text';
  // A file deleted under unsaved edits keeps its editor: the edits are still there.
  const editing = editor != null && edit != null && (isText || edit.dirty);
  const readOnly = content?.ok === true && content.kind !== 'text';
  return (
    <div className="center-view" data-testid="center-view" data-kind="file">
      <ViewHeader repoName={repoName} path={path} onOpenIn={onOpenIn}>
        {isNew && <span className="chip chip-new">new file</span>}
        <div className="spacer" />
        {editing && edit.dirty && (
          <>
            <span className="unsaved-mark">Unsaved</span>
            <button className="view-button save-button" title="Save (⌘S)" disabled={edit.saving} onClick={props.onSave}>
              Save
            </button>
          </>
        )}
        {readOnly && (
          <span className="read-only">
            <LockIcon size={12} />
            Read-only
          </span>
        )}
        {props.onHistory && !isNew && (
          <button className="view-button" data-testid="file-history-button" title="The commits that changed this file" onClick={props.onHistory}>
            <HistoryIcon size={12} />
            <span>History</span>
          </button>
        )}
      </ViewHeader>
      {editing && <EditBar {...props} edit={edit} />}
      {editing ? (
        <div className="file-editor" data-testid="file-editor">
          {editor}
        </div>
      ) : content?.ok && content.kind === 'media' ? (
        <MediaBody key={`${repoPath}\n${path}`} src={mediaUrl(repoPath, path, content.mtime)} media={content.media} name={path.slice(path.lastIndexOf('/') + 1)} />
      ) : (
        <FileBody content={content} tokens={tokens} />
      )}
    </div>
  );
}

/** Under the header: the file changed or vanished on disk under unsaved edits, or a save failed. */
function EditBar({ edit, onKeepMine, onLoadDisk, onClose }: FilePaneProps & { edit: EditState }) {
  if (edit.conflict === 'changed') {
    return (
      <div className="edit-bar" role="alert">
        <span>This file changed on disk.</span>
        <div className="spacer" />
        <button onClick={onLoadDisk}>Load disk version</button>
        <button onClick={onKeepMine}>Keep mine</button>
      </div>
    );
  }
  if (edit.conflict === 'missing') {
    return (
      <div className="edit-bar" role="alert">
        <span>This file was deleted on disk.</span>
        <div className="spacer" />
        <button onClick={onClose}>Close</button>
        <button onClick={onKeepMine}>Keep mine</button>
      </div>
    );
  }
  if (edit.error) {
    return (
      <div className="edit-bar error" role="alert">
        Could not save: {edit.error}
      </div>
    );
  }
  return null;
}

/** Image or video, from the main process's `edi-media://` URL; a note if it can't be opened. */
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
 * Polling rerenders the bound view every 2 s; as long as the content and colors stay the same object
 * (useView keeps the same object for the same data) this body isn't rerendered.
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
