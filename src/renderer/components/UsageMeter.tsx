import type { ClaudeUsage, UsageWindow } from '../../shared/api';
import { ago } from '../format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** Sıfırlanma anı, yerel saatle: bugünse "15:10", değilse "Fri 28 Nov 09:00". */
export function resetText(at: number, now: number): string {
  const date = new Date(at);
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (date.toDateString() === new Date(now).toDateString()) return time;
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

/** Verinin yaşı; saatler ve günler için de kısa. */
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

/** Üst çubukta Claude kullanım limitleri: 5 saatlik ve haftalık yüzde, sıfırlanma zamanı. */
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
        return (
          <span
            key={label}
            className="usage-window"
            data-testid="usage-window"
            data-level={level(window.percent)}
            title={`${name}: ${percent}% used · resets ${reset} · updated ${since(usage.updatedAt, now)}`}
          >
            <span className="usage-label">{label}</span>
            <span className="usage-bar" aria-hidden="true">
              <span className="usage-fill" style={{ width: `${Math.min(100, Math.max(0, window.percent))}%` }} />
            </span>
            <span className="usage-percent mono">{percent}%</span>
            <span className="usage-reset mono">{reset}</span>
          </span>
        );
      })}
    </div>
  );
}
