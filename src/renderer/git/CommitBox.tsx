import { menuKeys } from '../components/keys';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { CloudUpload } from 'lucide-react';
import { ArrowDown, ArrowUp, ChevronDown } from '../components/icons';
import { usePopover } from '../components/usePopover';
import type { CommitTarget, NextAction } from './model';

export interface CommitBoxProps {
  target: CommitTarget;
  message: string;
  /** An operation is in progress in the repo. */
  busy: boolean;
  /** The repo has a remote: "Commit and push" can be chosen. */
  canPush: boolean;
  onChange(message: string): void;
  onCommit(o: { all: boolean; push: boolean }): void;
  /** Next to the commit button: the Stash button. */
  aside?: ReactNode;
  /** With nothing to commit, what the button does instead (pull, push or publish); null when up to date. */
  next?: NextAction | null;
  onNext?(): void;
  /** In the box's top right corner: Claude Code writes the message. */
  messageButton?: ReactNode;
  /** Claude Code is writing the message: the box waits for it. */
  writing?: boolean;
}

/** The message box grows with its text up to this many lines, then scrolls. */
export const MAX_MESSAGE_LINES = 10;

/**
 * Fits the box to its text: one line when empty, taller as lines are added or wrap, up to `maxLines`; past
 * that it scrolls. Measured again when the text changes and when the panel's width does.
 */
export function fitHeight(field: HTMLTextAreaElement, maxLines: number): void {
  const style = getComputedStyle(field);
  const line = parseFloat(style.lineHeight) || 18;
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  field.style.height = 'auto';
  const content = field.scrollHeight + border;
  const max = line * maxLines + padding + border;
  field.style.height = `${Math.min(content, max)}px`;
  field.style.overflowY = content > max ? 'auto' : 'hidden';
}

/** Commit message and button. The first line is the subject, the rest the body; Cmd+Enter commits. */
export function CommitBox({ target, message, busy, canPush, onChange, onCommit, aside, next, onNext, messageButton, writing = false }: CommitBoxProps) {
  const menu = usePopover<HTMLDivElement>();
  const ready = target.enabled && !busy && message.trim() !== '';
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (field.current) fitHeight(field.current, MAX_MESSAGE_LINES);
  }, [message]);
  // A narrower or wider panel wraps the text differently.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fitHeight(element, MAX_MESSAGE_LINES);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const commit = (push: boolean) => {
    if (ready) onCommit({ all: target.all, push });
  };

  return (
    <div className="commit">
      <div className={`commit-field${messageButton ? ' has-button' : ''}`}>
        <textarea
          className="commit-message mono"
          data-testid="commit-message"
          aria-label="Commit message"
          placeholder={writing ? 'Claude Code is writing a message…' : 'Commit message'}
          spellCheck={false}
          ref={field}
          rows={1}
          value={message}
          readOnly={writing}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.metaKey) {
              event.preventDefault();
              commit(false);
            }
          }}
        />
        {messageButton && <span className="commit-field-button">{messageButton}</span>}
      </div>
      <div className="commit-actions">
        {next && target.count === 0 ? (
          // Nothing to commit: the button does what comes next. ⌘↵ in the message still only commits.
          <div className="commit-split">
            <button className="commit-button commit-next" data-testid="next-action" data-kind={next.kind} disabled={busy} title={next.title} onClick={onNext}>
              {next.kind === 'pull' ? (
                <ArrowDown size={13} strokeWidth={2} />
              ) : next.kind === 'push' ? (
                <ArrowUp size={13} strokeWidth={2} />
              ) : (
                <CloudUpload size={14} strokeWidth={2.2} aria-hidden="true" />
              )}
              <span>{next.label}</span>
            </button>
          </div>
        ) : (
        <div className="commit-split" ref={menu.ref} onKeyDown={menuKeys}>
          <button
            className={`commit-button${target.all ? ' commit-all' : ''}`}
            data-testid="commit-button"
            disabled={!ready}
            title={target.count === 0 ? 'Nothing to commit' : 'Commit (⌘↵)'}
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
        )}
        {aside}
      </div>
      {target.all && target.enabled && <p className="commit-note">Nothing is staged. This commits every change, new files included.</p>}
    </div>
  );
}
