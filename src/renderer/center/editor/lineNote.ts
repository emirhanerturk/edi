import type { BlameResult } from '../../../shared/api';
import { longAgo } from '../../history/time';

type Blame = Extract<BlameResult, { ok: true }>;

const MAX_SUBJECT = 80;

/** The muted note at the end of the cursor's line: who changed it, when and why; null if unknown. */
export function lineNote(blame: Pick<Blame, 'lines' | 'commits'>, line: number, now: number): { text: string; oid: string | null } | null {
  if (line < 1 || line > blame.lines.length) return null;
  const oid = blame.lines[line - 1];
  if (oid === null || oid === undefined) return oid === null ? { text: 'Not committed yet', oid: null } : null;
  const commit = blame.commits[oid];
  if (!commit) return null;
  const subject = commit.summary.length > MAX_SUBJECT ? `${commit.summary.slice(0, MAX_SUBJECT - 1)}…` : commit.summary;
  return { text: `${commit.authorName || commit.authorEmail}, ${longAgo(commit.date, now)} · ${subject}`, oid };
}
