// A summary's place: its sparkle and the card its result opens in, both found by the place's key in the store.
import type { ReactNode } from 'react';
import type { SummaryRequest, SummaryResult } from '../../shared/api';
import { useNow } from '../components/useNow';
import { SparkButton, SummaryCard, type SummaryCardProps } from './SummaryCard';
import { sparkState, useSummaries, useSummary } from './summaryStore';

export interface SummaryPlace {
  key: string;
  request: SummaryRequest;
  /** While it runs: "Claude Code is reading 4 commits…". */
  reading: string;
}

export const startSummary = (place: SummaryPlace): Promise<SummaryResult | null> =>
  useSummaries.getState().start(place.key, place.request, place.reading);
export const closeSummary = (key: string) => useSummaries.getState().close(key);

/** The place's sparkle: starts a run; stops it while it runs; closes its result. */
export function SummarySpark(props: { place: SummaryPlace; title: string; size?: number; disabled?: boolean; testId?: string; className?: string }) {
  const { place } = props;
  const run = useSummary(place.key);
  return (
    <SparkButton
      title={props.title}
      state={sparkState(run)}
      size={props.size}
      disabled={props.disabled && !run}
      testId={props.testId}
      className={props.className}
      onClick={() => (run ? closeSummary(place.key) : void startSummary(place))}
    />
  );
}

export type SummaryDone = Extract<SummaryResult, { ok: true }>;

/** The place's card, while it runs and with its result; nothing before it was asked for or once closed. */
export function PlaceCard(
  props: Omit<SummaryCardProps, 'run' | 'now' | 'onAgain' | 'onClose' | 'body' | 'actions'> & {
    place: SummaryPlace;
    /** The result's content, if not its text as Markdown. */
    body?(done: SummaryDone): ReactNode;
    /** Buttons for the result, beside refresh and close. */
    actions?(done: SummaryDone): ReactNode;
  },
) {
  const { place, body, actions, ...card } = props;
  const run = useSummary(place.key);
  const now = useNow(30_000);
  if (!run) return null;
  const done = run.result?.ok ? run.result : null;
  return (
    <SummaryCard
      {...card}
      run={run}
      now={now}
      body={body && done ? body(done) : undefined}
      actions={actions && done ? actions(done) : undefined}
      onAgain={() => void startSummary(place)}
      onClose={() => closeSummary(place.key)}
    />
  );
}
