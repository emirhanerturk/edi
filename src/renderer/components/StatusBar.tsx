import { useMemo } from 'react';
import { edi } from '../bridge';
import { ago, plural, summary } from '../format';
import { serverRows } from '../servers/model';
import { ServersMenu } from '../servers/ServersMenu';
import { useNow } from './useNow';
import { useApp } from '../store';

export function StatusBar() {
  const workspace = useApp((s) => s.workspace);
  const now = useNow(1000);
  // Short info on what's open in the center panel: language and line count for a file, totals for a diff.
  const info = useApp((s) => (s.center.open ? s.centerInfo : null));
  const { repos, withChanges, toPush } = summary(workspace);
  const servers = useApp((s) => s.servers);
  const tabs = useApp((s) => s.tabs);
  const rows = useMemo(() => serverRows(servers, tabs, workspace.repos), [servers, tabs, workspace.repos]);

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
      <ServersMenu rows={rows} onOpen={(url) => void edi.openUrl(url)} />
      {info !== null ? (
        <span data-testid="center-info">{info}</span>
      ) : (
        workspace.refreshedAt > 0 && <span>refreshed {ago(workspace.refreshedAt, now)}</span>
      )}
    </footer>
  );
}
