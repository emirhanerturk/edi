// A pull request Claude Code drafted: its text as it will be pasted, Copy, and Push and open on GitHub.
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, ExternalIcon } from '../components/icons';
import type { SummaryDone } from './places';

/** GitHub keeps a query this long at most; past it the description is left for Copy. */
export const MAX_URL = 8000;

/** GitHub's page for opening the pull request with its title and description filled in. */
export function pullRequestUrl(compareUrl: string, title: string, body: string): string {
  const base = `${compareUrl}?expand=1&title=${encodeURIComponent(title)}`;
  const full = `${base}&body=${encodeURIComponent(body)}`;
  return full.length <= MAX_URL ? full : base;
}

export function PullRequestBody({ title, body }: { title: string; body: string }) {
  return (
    <div className="summary-pr" data-testid="pull-request-text">
      <div className="summary-pr-title">{title}</div>
      {body !== '' && <pre className={`summary-pr-body${body.split('\n').length > 16 ? ' long' : ''}`}>{body}</pre>}
    </div>
  );
}

/** Copy, and (for a branch going into another on GitHub) push it, then open the pull request's page. */
export function PullRequestActions({ done, onOpen, busy }: { done: SummaryDone; onOpen?(url: string): void; busy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const title = done.title ?? '';
  const copy = () => {
    void navigator.clipboard.writeText(done.text === '' ? title : `${title}\n\n${done.text}`).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <>
      <button className="icon-button tiny" data-testid="copy-pull-request" aria-label="Copy title and description" title={copied ? 'Copied' : 'Copy title and description'} onClick={copy}>
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      </button>
      {done.compareUrl && onOpen && (
        <button
          className="summary-button"
          data-testid="open-pull-request"
          title="Push the branch, then open a pull request on GitHub with this title and description"
          disabled={busy}
          onClick={() => onOpen(pullRequestUrl(done.compareUrl!, title, done.text))}
        >
          Push and open on GitHub
          <ExternalIcon size={11} />
        </button>
      )}
    </>
  );
}
