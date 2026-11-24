import type { ClaudeUsage, UsageWindow } from '../../shared/api';
import { ago } from '../format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** Reset time in local time: "15:10" if today, otherwise "Fri 28 Nov 09:00". */
export function resetText(at: number, now: number): string {
  const date = new Date(at);
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (date.toDateString() === new Date(now).toDateString()) return time;
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

/** Time left until the reset: "1h 3m" (or "5m") under a day, "2d 4h" from a day on. */
export function leftText(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((at - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** The data's age; short for hours and days too. */
function since(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 60) return ago(then, now);
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (24 * 60))}d ago`;
}

const level = (percent: number) => (percent >= 90 ? 'high' : percent >= 70 ? 'warn' : 'normal');

interface Props {
  usage: ClaudeUsage | null;
  now: number;
}

/** Claude usage limits in the top bar: 5-hour and weekly percentage, reset time. */
export function UsageMeter({ usage, now }: Props) {
  if (!usage) return null;
  const windows: [string, string, UsageWindow | null][] = [
    ['5h', '5-hour limit', usage.fiveHour],
    ['Week', 'Weekly limit', usage.week],
  ];
  const shown = windows.filter((entry): entry is [string, string, UsageWindow] => entry[2] !== null && entry[2].resetsAt > now);
  if (shown.length === 0) return null;
  return (
    <div className="usage" data-testid="usage">
      {shown.map(([label, name, window]) => {
        const percent = Math.round(window.percent);
        const reset = resetText(window.resetsAt, now);
        const left = leftText(window.resetsAt, now);
        return (
          <span
            key={label}
            className="usage-window"
            data-testid="usage-window"
            data-level={level(window.percent)}
            title={`${name}: ${percent}% used · resets ${reset}, in ${left} · updated ${since(usage.updatedAt, now)}`}
          >
            <span className="usage-label">{label}</span>
            <span className="usage-bar" aria-hidden="true">
              <span className="usage-fill" style={{ width: `${Math.min(100, Math.max(0, window.percent))}%` }} />
            </span>
            <span className="usage-percent mono">{percent}%</span>
            <span className="usage-reset mono">{reset}</span>
            <span className="usage-left mono">({left})</span>
          </span>
        );
      })}
    </div>
  );
}
