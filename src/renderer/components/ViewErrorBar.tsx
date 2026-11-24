import { useApp } from '../store';
import { CloseIcon, WarningIcon } from './icons';

/**
 * Error from a view action (Open in Zed) started by the center panel or the Git tab.
 * Sits at the bottom of the window, above the status bar, so it shows even when the panel is closed.
 */
export function ViewErrorBar() {
  const error = useApp((s) => s.centerError);
  if (error === null) return null;
  return (
    <div className="view-error" role="alert">
      <WarningIcon size={13} />
      <span>{error}</span>
      <div className="spacer" />
      <button className="icon-button tiny" aria-label="Dismiss" title="Dismiss" onClick={() => useApp.getState().dismissCenterError()}>
        <CloseIcon size={11} />
      </button>
    </div>
  );
}
