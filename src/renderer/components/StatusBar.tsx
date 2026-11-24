import { ago, plural, summary } from '../format';
import { useNow } from './useNow';
import { useApp } from '../store';

export function StatusBar() {
  const workspace = useApp((s) => s.workspace);
  const now = useNow(1000);
  // Orta panelde açık olanın kısa bilgisi: dosyada dil ve satır sayısı, diff'te toplamlar.
  const info = useApp((s) => (s.center.open ? s.centerInfo : null));
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
      {info !== null ? (
        <span data-testid="center-info">{info}</span>
      ) : (
        workspace.refreshedAt > 0 && <span>refreshed {ago(workspace.refreshedAt, now)}</span>
      )}
    </footer>
  );
}
