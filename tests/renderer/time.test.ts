import { describe, expect, it } from 'vitest';
import { dayLabel, longAgo, shortAgo, splitSubject } from '../../src/renderer/history/time';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;
const now = new Date(2026, 10, 24, 15, 30).getTime();

describe('shortAgo', () => {
  it('short age for rows', () => {
    const cases: [number, string][] = [
      [-5 * S, 'now'],
      [59 * S, 'now'],
      [60 * S, '1m'],
      [59 * M, '59m'],
      [60 * M, '1h'],
      [23 * H, '23h'],
      [47 * H, '1d'],
      [6 * D, '6d'],
      [13 * D, '1w'],
      [29 * D, '4w'],
      [31 * D, '1mo'],
      [364 * D, '12mo'],
      [365 * D, '1y'],
      [2 * 365 * D, '2y'],
    ];
    for (const [elapsed, text] of cases) expect(shortAgo(now - elapsed, now), String(elapsed)).toBe(text);
  });
});

describe('longAgo', () => {
  it('long age for the commit view and the By repo notes', () => {
    const cases: [number, string][] = [
      [30 * S, 'just now'],
      [60 * S, '1 minute ago'],
      [25 * M, '25 minutes ago'],
      [60 * M, '1 hour ago'],
      [23 * H, '23 hours ago'],
      [30 * H, 'yesterday'],
      [5 * D, '5 days ago'],
      [8 * D, 'last week'],
      [15 * D, '2 weeks ago'],
      [40 * D, 'last month'],
      [100 * D, '3 months ago'],
      [400 * D, 'last year'],
      [800 * D, '2 years ago'],
    ];
    for (const [elapsed, text] of cases) expect(longAgo(now - elapsed, now), String(elapsed)).toBe(text);
  });
});

describe('dayLabel', () => {
  it('today, yesterday, this week, then the date (in local time)', () => {
    expect(dayLabel(new Date(2026, 10, 24, 0, 1).getTime(), now)).toBe('TODAY');
    expect(dayLabel(new Date(2026, 10, 23, 23, 59).getTime(), now)).toBe('YESTERDAY');
    expect(dayLabel(new Date(2026, 10, 23, 0, 0).getTime(), now)).toBe('YESTERDAY');
    expect(dayLabel(new Date(2026, 10, 22, 12, 0).getTime(), now)).toBe('THIS WEEK');
    expect(dayLabel(new Date(2026, 10, 18, 0, 0).getTime(), now)).toBe('THIS WEEK');
    expect(dayLabel(new Date(2026, 10, 17, 23, 0).getTime(), now)).toBe('NOV 17');
    expect(dayLabel(new Date(2026, 0, 3, 9, 0).getTime(), now)).toBe('JAN 3');
    expect(dayLabel(new Date(2025, 11, 31, 9, 0).getTime(), now)).toBe('DEC 31, 2025');
  });
});

describe('splitSubject', () => {
  it('splits off the Conventional Commits prefix', () => {
    expect(splitSubject('feat(music-quiz): move the banner')).toEqual({ prefix: 'feat(music-quiz): ', rest: 'move the banner' });
    expect(splitSubject('fix!: drop node 18')).toEqual({ prefix: 'fix!: ', rest: 'drop node 18' });
    expect(splitSubject('refactor(api)!: rename')).toEqual({ prefix: 'refactor(api)!: ', rest: 'rename' });
  });

  it('leaves a subject without a prefix alone', () => {
    for (const subject of [
      'Merge pull request #187 from feat/consent-pings',
      'Revert "feat: x"',
      `${'a'.repeat(32)}: too far`,
      'v1.86.0',
      '',
      ': nothing',
    ]) {
      expect(splitSubject(subject), subject).toEqual({ prefix: '', rest: subject });
    }
  });
});
