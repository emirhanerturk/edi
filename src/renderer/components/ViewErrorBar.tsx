import { useApp } from '../store';
import { CloseIcon, WarningIcon } from './icons';

/**
 * Orta panelin ya da Git sekmesinin başlattığı bir görünüm işleminin (Open in Zed) hatası.
 * Panel kapalıyken de görünsün diye pencerenin altında, durum çubuğunun üstünde durur.
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
