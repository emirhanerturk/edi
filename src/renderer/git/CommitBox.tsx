import { ChevronDown } from '../components/icons';
import { usePopover } from '../components/usePopover';
import type { CommitTarget } from './model';

export interface CommitBoxProps {
  target: CommitTarget;
  message: string;
  /** Repoda süren bir işlem var. */
  busy: boolean;
  /** Repoda remote var: "Commit and push" seçilebilir. */
  canPush: boolean;
  onChange(message: string): void;
  onCommit(o: { all: boolean; push: boolean }): void;
}

/** Commit mesajı ve düğmesi. İlk satır başlık, gerisi gövdedir; Cmd+Enter commit eder. */
export function CommitBox({ target, message, busy, canPush, onChange, onCommit }: CommitBoxProps) {
  const menu = usePopover<HTMLDivElement>();
  const ready = target.enabled && !busy && message.trim() !== '';
  const lines = message.split('\n').length;

  const commit = (push: boolean) => {
    if (ready) onCommit({ all: target.all, push });
  };

  return (
    <div className="commit">
      <textarea
        className="commit-message mono"
        data-testid="commit-message"
        aria-label="Commit message"
        placeholder="Commit message"
        spellCheck={false}
        rows={Math.min(10, Math.max(2, lines))}
        value={message}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.metaKey) {
            event.preventDefault();
            commit(false);
          }
        }}
      />
      <div className="commit-actions" ref={menu.ref}>
        <button
          className={`commit-button${target.all ? ' commit-all' : ''}`}
          data-testid="commit-button"
          disabled={!ready}
          title="Commit (⌘↵)"
          onClick={() => commit(false)}
        >
          {target.label}
        </button>
        <button
          className={`commit-button commit-caret${target.all ? ' commit-all' : ''}`}
          aria-label="Commit options"
          aria-haspopup="menu"
          aria-expanded={menu.open}
          disabled={!ready}
          onClick={() => menu.setOpen(!menu.open)}
        >
          <ChevronDown size={11} strokeWidth={2} />
        </button>
        {menu.open && (
          <div className="menu commit-menu" role="menu">
            <button
              className="menu-item"
              role="menuitem"
              disabled={!canPush}
              title={canPush ? undefined : 'This repository has no remote'}
              onClick={() => {
                menu.setOpen(false);
                commit(true);
              }}
            >
              Commit and push
            </button>
          </div>
        )}
      </div>
      {target.all && target.enabled && <p className="commit-note">Nothing is staged. This commits every change, new files included.</p>}
    </div>
  );
}
