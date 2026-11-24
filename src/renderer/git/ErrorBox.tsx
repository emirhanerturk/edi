import { WarningIcon } from '../components/icons';
import { isRejectedPush } from './model';

/** Error box under the repo: git's most informative line. */
export function ErrorBox({ error, onPull, onDismiss }: { error: string; onPull?: () => void; onDismiss(): void }) {
  const rejected = isRejectedPush(error);
  return (
    <div className="error-box" data-testid="error-box" role="alert">
      <WarningIcon size={13} style={{ flex: 'none', color: 'var(--red)', marginTop: 2 }} />
      <div className="error-body">
        {rejected && <div className="error-title">Push was rejected</div>}
        <div className="error-text mono">{error}</div>
        <div className="error-actions">
          {rejected && onPull && (
            <button className="button-outline" onClick={onPull}>
              Pull
            </button>
          )}
          <button className="button-quiet" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
