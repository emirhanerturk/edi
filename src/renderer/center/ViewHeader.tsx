import type { ReactNode } from 'react';
import { ExternalIcon } from '../components/icons';

/** Shared header for the diff and file views: repo, path, extras in between and "Open in Zed". */
export function ViewHeader({ repoName, path, children, onOpenInZed }: { repoName: string; path: string; children?: ReactNode; onOpenInZed(): void }) {
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
      <button className="zed-button" onClick={onOpenInZed}>
        <span>Open in Zed</span>
        <ExternalIcon size={12} />
      </button>
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
