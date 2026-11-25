// The Projects screen's rules: badges and when a project was last opened. Pure functions.
import type { ProjectView } from '../../shared/api';

const DAY = 86_400_000;
const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** When the project was last opened: "Today", "Yesterday", "Mon" within a week, "21 Nov", "21 Nov 2025"; empty if unknown. */
export function openedLabel(then: number, now: number): string {
  if (then <= 0) return '';
  // Rounded: a day with a clock change is 23 or 25 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const date = new Date(then);
  if (days < 7) return date.toLocaleDateString('en-GB', { weekday: 'short' });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The card's badge: "Open" on the project open in the window when the screen is shown over it;
 * otherwise "Last opened" on the first card (the list is last opened first), if it was ever opened.
 */
export function badgeOf(project: ProjectView, index: number, projects: ProjectView[]): 'open' | 'last' | null {
  if (projects.some((other) => other.open)) return project.open ? 'open' : null;
  return index === 0 && project.openedAt > 0 ? 'last' : null;
}
