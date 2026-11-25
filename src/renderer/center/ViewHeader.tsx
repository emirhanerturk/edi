import type { ReactNode } from 'react';
import { OpenInMenu } from '../components/OpenInMenu';
import type { EditorId } from '../../shared/editors';

/** Shared header for the diff and file views: repo, path, extras in between and "Open in…". */
export function ViewHeader({ repoName, path, children, onOpenIn }: { repoName: string; path: string; children?: ReactNode; onOpenIn(editor: EditorId): void }) {
  const slash = path.lastIndexOf('/');
  return (
    <div className="view-header" data-testid="view-header">
      <span className="view-repo">{repoName}</span>
      <span className="view-sep">/</span>
      <span className="view-path mono" title={path}>
        {path.slice(0, slash + 1)}
        <span className="view-name">{path.slice(slash + 1)}</span>
      </span>
      {children}
      <OpenInMenu onOpen={onOpenIn} />
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
