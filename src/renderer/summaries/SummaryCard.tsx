import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SummaryResult } from '../../shared/api';
import { CloseIcon, RefreshIcon } from '../components/icons';
import { resetText } from '../components/UsageMeter';
import { longAgo } from '../history/time';
import { Markdown } from './Markdown';
import type { SummaryRun } from './summaryStore';
import './summaries.css';

export type SparkState = 'idle' | 'running' | 'on';

export interface SparkButtonProps {
  /** What it does: its tooltip and its name for a screen reader. */
  title: string;
  state: SparkState;
  /** 12 on a row's header, 13 in the commit box. */
  size?: number;
  disabled?: boolean;
  /** Starts a run; while one runs, stops it; with its result open, closes it. */
  onClick(): void;
  testId?: string;
  className?: string;
}

/** The one Claude summary button: Lucide's Sparkles, muted when idle, in Claude's colour while it runs and while its result is open. */
export function SparkButton({ title, state, size = 12, disabled, onClick, testId, className }: SparkButtonProps) {
  const tip = state === 'running' ? 'Stop Claude Code' : state === 'on' ? `${title} (open: click to close)` : title;
  return (
    <button
      className={`icon-button tiny spark-button${className ? ` ${className}` : ''}`}
      data-testid={testId}
      data-state={state}
      aria-label={state === 'running' ? 'Stop Claude Code' : title}
      title={tip}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Sparkles size={size} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

type Failure = Extract<SummaryResult, { ok: false }>;

/** A failed run's first line and what to do about it. */
export function problemText(result: Failure, now: number): { title: string; detail: ReactNode } {
  if (result.reason === 'missing') {
    return {
      title: "Claude Code isn't installed, or edi can't find it.",
      detail: (
        <>
          edi runs <code>claude</code> from your login shell's PATH, as the terminals do.
        </>
      ),
    };
  }
  if (result.reason === 'limit') {
    const when = result.resetsAt ? `It resets ${resetText(result.resetsAt, now).replace(/^(Today|Tomorrow)/, (day) => day.toLowerCase())}. ` : '';
    return { title: result.error, detail: `${when}The usage meter in the title bar shows the same.` };
  }
  return { title: "Claude Code couldn't finish.", detail: result.error };
}

export interface SummaryCardProps {
  /** The result's heading: SUMMARY, WHAT CHANGED, PULL REQUEST, EXPLANATION, TODAY. */
  label: string;
  run: SummaryRun;
  now: number;
  /** Asks again (the refresh button, Try again). */
  onAgain(): void;
  /** Closes the card; while it runs, stops it. */
  onClose(): void;
  /** Buttons beside refresh and close, for a result. */
  actions?: ReactNode;
  /** The result's content; its text as Markdown by default. */
  body?: ReactNode;
  againLabel?: string;
  closeLabel?: string;
  testId?: string;
  className?: string;
}

/** A summary in place: reading while it runs, then the result, or why there is none. */
export function SummaryCard(props: SummaryCardProps) {
  const { label, run, now, onAgain, onClose, actions, againLabel = 'Summarize again', closeLabel = 'Close the summary' } = props;
  const { result } = run;
  const className = `summary-card${props.className ? ` ${props.className}` : ''}`;
  const close = (
    <button className="icon-button tiny" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
      <CloseIcon size={11} />
    </button>
  );

  if (result === null) {
    return (
      <div className={className} data-testid={props.testId} data-state="running" aria-busy="true">
        <div className="summary-head">
          <span className="summary-spark">
            <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="summary-reading">{run.reading}</span>
          <button className="summary-button" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="summary-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (!result.ok) {
    const { title, detail } = problemText(result, now);
    return (
      <div className={className} data-testid={props.testId} data-state="error" role="alert">
        <div className="summary-head">
          <span className="summary-problem">{title}</span>
          {close}
        </div>
        <div className="summary-detail">{detail}</div>
        {result.reason !== 'missing' && (
          <div>
            <button className="summary-button" onClick={onAgain}>
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className} data-testid={props.testId} data-state="done">
      <div className="summary-head">
        <span className="summary-spark">
          <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="summary-label">{label}</span>
        {actions}
        <button className="icon-button tiny" aria-label={againLabel} title={againLabel} onClick={onAgain}>
          <RefreshIcon size={12} />
        </button>
        {close}
      </div>
      <div className="summary-body">{props.body ?? <Markdown text={result.text} />}</div>
      <div className="summary-foot">
        Claude Code · {result.about} · {longAgo(result.at, now)}
      </div>
    </div>
  );
}
