import { WarningIcon } from '../components/icons';
import { isRejectedPush } from './model';

export interface ErrorBoxProps {
  error: string;
  onPull?: () => void;
  /** Git refused a switch or pull because of local changes: stash them and run it again ("Stash and switch"). */
  retry?: { label: string; run(): void };
  onDismiss(): void;
}

/** Error box under the repo: git's most informative line. */
export function ErrorBox({ error, onPull, retry, onDismiss }: ErrorBoxProps) {
  const rejected = isRejectedPush(error);
  return (
    <div className="error-box" data-testid="error-box" role="alert">
      <WarningIcon size={13} style={{ flex: 'none', color: 'var(--red)', marginTop: 2 }} />
      <div className="error-body">
        {rejected && <div className="error-title">Push was rejected</div>}
        {retry && <div className="error-title">Local changes are in the way</div>}
        <div className="error-text mono">{error}</div>
        <div className="error-actions">
          {rejected && onPull && (
            <button className="button-outline" onClick={onPull}>
              Pull
            </button>
          )}
          {retry && (
            <button className="button-outline" data-testid="stash-retry" onClick={retry.run}>
              {retry.label}
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
