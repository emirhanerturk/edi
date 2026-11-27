import { Sparkles } from 'lucide-react';
import { closeSummary, type SummaryPlace, startSummary } from './places';
import { sparkState, useSummary } from './summaryStore';

/** The commit view's Explain: the sparkle with a word, as the header's other buttons have. */
export function ExplainButton({ place }: { place: SummaryPlace }) {
  const run = useSummary(place.key);
  const state = sparkState(run);
  return (
    <button
      className="commit-copy commit-explain"
      data-testid="explain-commit"
      data-state={state}
      title={state === 'running' ? 'Stop Claude Code' : state === 'on' ? 'Close the explanation' : 'Explain this commit with Claude Code'}
      onClick={() => (run ? closeSummary(place.key) : void startSummary(place))}
    >
      <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
      <span>{state === 'running' ? 'Explaining…' : 'Explain'}</span>
    </button>
  );
}
