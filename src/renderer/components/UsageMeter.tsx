import { useEffect, useRef, useState } from 'react';
import type { ClaudeUsage, UsageWindow } from '../../shared/api';
import { ago } from '../format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');
const HOUR = 3_600_000;

/** Reset time in local time: "Today 15:10", "Tomorrow 09:00", otherwise "Fri 28 Nov 09:00". */
export function resetText(at: number, now: number): string {
  const date = new Date(at);
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (date.toDateString() === new Date(now).toDateString()) return `Today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

/** A duration: "1h 3m" (or "5m") under a day, "2d 4h" from a day on. */
export function durationText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** Time left until the reset. */
export const leftText = (at: number, now: number): string => durationText(at - now);

/** The data's age; short for hours and days too. */
function since(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 60) return ago(then, now);
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (24 * 60))}d ago`;
}

type Level = 'normal' | 'warn' | 'high';
const level = (percent: number): Level => (percent >= 90 ? 'high' : percent >= 70 ? 'warn' : 'normal');

/**
 * Where the window is heading at the current rate. Too early to tell in its first tenth:
 * a few percent in the first minutes would project far past the limit.
 */
export function pace(percent: number, elapsedMs: number, lengthMs: number, leftMs: number): { text: string; level: Level } {
  if (percent >= 100) return { text: 'Limit reached', level: 'high' };
  if (elapsedMs < lengthMs / 10 || percent <= 0) return { text: 'Too early to tell', level: 'normal' };
  const projected = (percent * lengthMs) / elapsedMs;
  if (projected < 100) return { text: `≈${Math.round(projected)}% by reset`, level: level(projected) };
  const untilFull = ((100 - percent) / percent) * elapsedMs;
  return untilFull < leftMs ? { text: `Limit in ≈${durationText(untilFull)}`, level: 'high' } : { text: '≈100% by reset', level: 'warn' };
}

interface Shown {
  key: string;
  label: string;
  name: string;
  lengthMs: number;
  window: UsageWindow;
}

interface Props {
  usage: ClaudeUsage | null;
  now: number;
}

/** Claude usage limits in the top bar: percentage and time left; hovering opens every detail below it. */
export function UsageMeter({ usage, now }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!usage) return null;
  const windows: Shown[] = [];
  if (usage.fiveHour) windows.push({ key: '5h', label: '5h', name: '5-hour limit', lengthMs: 5 * HOUR, window: usage.fiveHour });
  if (usage.week) windows.push({ key: 'week', label: 'Week', name: 'Weekly limit', lengthMs: 7 * 24 * HOUR, window: usage.week });
  const shown = windows.filter((entry) => entry.window.resetsAt > now);
  if (shown.length === 0) return null;

  // A short delay both ways: passing over it doesn't flash the panel, and the pointer can cross into the panel.
  const hover = (next: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? 120 : 160);
  };

  return (
    <div className="usage" data-testid="usage" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div
        className="usage-trigger"
        data-open={open}
        tabIndex={0}
        aria-label="Claude usage limits"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {shown.map(({ key, label, window }) => (
          <span key={key} className="usage-window" data-testid="usage-window" data-level={level(window.percent)}>
            <span className="usage-label">{label}</span>
            <span className="usage-bar" aria-hidden="true">
              <span className="usage-fill" style={{ width: `${Math.min(100, Math.max(0, window.percent))}%` }} />
            </span>
            <span className="usage-percent mono">{Math.round(window.percent)}%</span>
            <span className="usage-left mono">{leftText(window.resetsAt, now)}</span>
          </span>
        ))}
      </div>
      {open && <UsagePanel windows={shown} updatedAt={usage.updatedAt} now={now} />}
    </div>
  );
}

function UsagePanel({ windows, updatedAt, now }: { windows: Shown[]; updatedAt: number; now: number }) {
  return (
    <div className="usage-panel" data-testid="usage-panel" role="dialog" aria-label="Claude usage limits">
      {windows.map(({ key, name, lengthMs, window }) => {
        const leftMs = window.resetsAt - now;
        const elapsedMs = Math.min(lengthMs, Math.max(0, lengthMs - leftMs));
        const elapsedPercent = Math.round((elapsedMs / lengthMs) * 100);
        const forecast = pace(window.percent, elapsedMs, lengthMs, leftMs);
        return (
          <section key={key} className="usage-detail" data-testid="usage-detail" data-level={level(window.percent)}>
            <div className="usage-detail-head">
              <span>{name}</span>
              <span className="usage-percent mono">{Math.round(window.percent)}% used</span>
            </div>
            {/* The fill is the usage; the tick is how much of the window has passed. */}
            <div className="usage-detail-bar" aria-hidden="true">
              <span className="usage-fill" style={{ width: `${Math.min(100, Math.max(0, window.percent))}%` }} />
              <span className="usage-tick" style={{ left: `${elapsedPercent}%` }} />
            </div>
            <dl className="usage-rows mono">
              <dt>Resets</dt>
              <dd>
                {resetText(window.resetsAt, now)} · in {durationText(leftMs)}
              </dd>
              <dt>Elapsed</dt>
              <dd>
                {durationText(elapsedMs)} of {durationText(lengthMs).replace(/ 0[hm]$/, '')} · {elapsedPercent}%
              </dd>
              <dt>Pace</dt>
              <dd data-level={forecast.level}>{forecast.text}</dd>
            </dl>
          </section>
        );
      })}
      <div className="usage-panel-foot">From Claude Code's status line · updated {since(updatedAt, now)}</div>
    </div>
  );
}
