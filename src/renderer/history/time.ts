// History için zaman ve konu satırı biçimleri. Saf işlevler; gün başlıkları yerel saate göredir.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const elapsed = (then: number, now: number) => Math.max(0, now - then);

/** Satırlardaki kısa süre: "now", "25m", "3h", "2d", "3w", "5mo", "2y". */
export function shortAgo(then: number, now: number): string {
  const ms = elapsed(then, now);
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  const days = Math.floor(ms / DAY);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

const count = (n: number, unit: string, last: string) => (n === 1 ? last : `${n} ${unit}s ago`);

/** Uzun süre: "just now", "25 minutes ago", "yesterday", "2 weeks ago", "last month" … */
export function longAgo(then: number, now: number): string {
  const ms = elapsed(then, now);
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return count(Math.floor(ms / MINUTE), 'minute', '1 minute ago');
  if (ms < DAY) return count(Math.floor(ms / HOUR), 'hour', '1 hour ago');
  if (ms < 2 * DAY) return 'yesterday';
  const days = Math.floor(ms / DAY);
  if (days < 7) return `${days} days ago`;
  if (days < 30) return count(Math.floor(days / 7), 'week', 'last week');
  if (days < 365) return count(Math.floor(days / 30), 'month', 'last month');
  return count(Math.floor(days / 365), 'year', 'last year');
}

const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Gün başlığı: TODAY, YESTERDAY, THIS WEEK (dünden önceki beş gün), sonra "NOV 12" ya da "NOV 12, 2025". */
export function dayLabel(then: number, now: number): string {
  // Yaz saati geçişinde gün 23 ya da 25 saat sürer: yuvarlamak takvim gününü verir.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  if (days <= 6) return 'THIS WEEK';
  const date = new Date(then);
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}

/** "tür(kapsam)!: " biçimi; ilk 32 karakter içinde biter. */
const PREFIX = /^[\w-]+(\([^()]*\))?!?: /;

/** Konu satırını sönük gösterilen Conventional Commits ön eki ve geri kalanı olarak ayırır. */
export function splitSubject(subject: string): { prefix: string; rest: string } {
  const match = PREFIX.exec(subject);
  if (!match || match[0].length - 2 >= 32) return { prefix: '', rest: subject };
  return { prefix: match[0], rest: subject.slice(match[0].length) };
}
