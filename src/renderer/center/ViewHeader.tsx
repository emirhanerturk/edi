import type { ReactNode } from 'react';
import { OpenInMenu } from '../components/OpenInMenu';
import type { EditorId } from '../../shared/editors';

export interface ViewHeaderProps {
  repoName: string;
  path: string;
  /** Beside the path: its counts or a chip. */
  info?: ReactNode;
  /** The buttons, before "Open in…". */
  children?: ReactNode;
  onOpenIn(editor: EditorId): void;
}

/**
 * Shared header for the diff, file and file history views: repo / path and what goes with it on the left,
 * the buttons and "Open in…" on the right. Short of room, the buttons move to a second line, still on the right.
 */
export function ViewHeader({ repoName, path, info, children, onOpenIn }: ViewHeaderProps) {
  const slash = path.lastIndexOf('/');
  return (
    <div className="view-header" data-testid="view-header">
      <div className="view-title" data-testid="view-title">
        <span className="view-repo">{repoName}</span>
        <span className="view-sep">/</span>
        <span className="view-path mono" title={path}>
          {path.slice(0, slash + 1)}
          <span className="view-name">{path.slice(slash + 1)}</span>
        </span>
        {info}
      </div>
      <div className="view-actions" data-testid="view-actions">
        {children}
        <OpenInMenu onOpen={onOpenIn} />
      </div>
    </div>
  );
}

/** A short note shown in place of the view's body. */
export function ViewNote({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <div className="view-note" role={alert ? 'alert' : undefined}>
      {children}
    </div>
  );
}
