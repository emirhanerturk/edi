import { useEffect, useState } from 'react';
import { ago, plural, summary } from '../format';
import { useApp } from '../store';

export function StatusBar() {
  const workspace = useApp((s) => s.workspace);
  const now = useNow(1000);
  const { repos, withChanges, toPush } = summary(workspace);

  return (
    <footer className="statusbar" data-testid="statusbar">
      <span>{plural(repos, 'repository', 'repositories')}</span>
      {withChanges > 0 && (
        <span>
          <span style={{ color: 'var(--yellow)' }}>●</span> {withChanges} with changes
        </span>
      )}
      {toPush > 0 && (
        <span>
          <span style={{ color: 'var(--accent)' }}>↑</span> {toPush} to push
        </span>
      )}
      <div className="spacer" />
      {workspace.refreshedAt > 0 && <span>refreshed {ago(workspace.refreshedAt, now)}</span>}
    </footer>
  );
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
