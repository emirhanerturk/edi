import { useApp } from '../store';
import { CloseIcon, WarningIcon } from './icons';

/**
 * Error from a view action (Open in Zed) started by the center panel or the Git tab, or from a folder
 * that could not be opened while another one is open (with none open, the empty screen shows it).
 * Sits at the bottom of the window, above the status bar, so it shows even when the panel is closed.
 */
export function ViewErrorBar() {
  const centerError = useApp((s) => s.centerError);
  const openError = useApp((s) => s.openError);
  const error = centerError ?? openError;
  if (error === null) return null;
  const dismiss = () => (centerError !== null ? useApp.getState().dismissCenterError() : useApp.getState().dismissOpenError());
  return (
    <div className="view-error" role="alert">
      <WarningIcon size={13} />
      <span>{error}</span>
      <div className="spacer" />
      <button className="icon-button tiny" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
        <CloseIcon size={11} />
      </button>
    </div>
  );
}
