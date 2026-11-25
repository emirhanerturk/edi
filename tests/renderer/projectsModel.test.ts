import { describe, expect, it } from 'vitest';
import type { ProjectView } from '../../src/shared/api';
import { badgeOf, openedLabel } from '../../src/renderer/projects/model';

// Local time, as the labels are.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 11, 25, 10);

describe('openedLabel', () => {
  it('today, yesterday, the weekday within a week, then the date', () => {
    expect(openedLabel(at(2026, 11, 25, 1), NOW)).toBe('Today');
    expect(openedLabel(at(2026, 11, 24, 23), NOW)).toBe('Yesterday');
    expect(openedLabel(at(2026, 11, 23), NOW)).toBe('Mon');
    expect(openedLabel(at(2026, 11, 19), NOW)).toBe('Thu');
    expect(openedLabel(at(2026, 11, 18), NOW)).toBe('18 Nov');
    expect(openedLabel(at(2025, 11, 21), NOW)).toBe('21 Nov 2025');
  });

  it('is empty when the time is unknown, and today for a time ahead of the clock', () => {
    expect(openedLabel(0, NOW)).toBe('');
    expect(openedLabel(NOW + 3_600_000, NOW)).toBe('Today');
  });
});

const view = (id: string, over: Partial<ProjectView> = {}): ProjectView => ({
  id,
  dir: `/s/${id}`,
  name: id,
  logo: { kind: 'letter', color: 'blue' },
  links: [],
  openedAt: 10,
  repoCount: 1,
  logoUrl: null,
  exists: true,
  open: false,
  ...over,
});

describe('badgeOf', () => {
  it('marks the first card Last opened when no project is open', () => {
    const projects = [view('a'), view('b')];
    expect(projects.map((project, index) => badgeOf(project, index, projects))).toEqual(['last', null]);
  });

  it('marks the open project Open, and nothing else, when one is open', () => {
    const projects = [view('a'), view('b', { open: true })];
    expect(projects.map((project, index) => badgeOf(project, index, projects))).toEqual([null, 'open']);
  });

  it('gives no badge to a first card never opened', () => {
    const projects = [view('a', { openedAt: 0 })];
    expect(badgeOf(projects[0]!, 0, projects)).toBeNull();
  });
});
