// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageMeter, leftText, pace, resetText } from '../../src/renderer/components/UsageMeter';
import type { ClaudeUsage } from '../../src/shared/api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Local time: the tests are written against local time, not TZ=UTC, and build their instants in local time.
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 24, 12, 0);

describe('resetText', () => {
  it('today, tomorrow, otherwise day and date, with the time', () => {
    expect(resetText(at(2026, 11, 24, 15, 10), NOW)).toBe('Today 15:10');
    expect(resetText(at(2026, 11, 25, 9, 5), NOW)).toBe('Tomorrow 09:05');
    expect(resetText(at(2026, 11, 28, 0, 0), NOW)).toBe('Sat 28 Nov 00:00');
  });
});

describe('leftText', () => {
  it('hours and minutes under a day, days and hours from a day on', () => {
    expect(leftText(NOW + 63 * 60_000, NOW)).toBe('1h 3m');
    expect(leftText(NOW + 5 * 60_000 + 59_000, NOW)).toBe('5m');
    expect(leftText(NOW + 30_000, NOW)).toBe('0m');
    expect(leftText(NOW + 23 * 3_600_000 + 59 * 60_000, NOW)).toBe('23h 59m');
    expect(leftText(NOW + (2 * 24 + 4) * 3_600_000 + 10 * 60_000, NOW)).toBe('2d 4h');
    expect(leftText(NOW + 24 * 3_600_000, NOW)).toBe('1d 0h');
  });
});

describe('pace', () => {
  const H = 3_600_000;
  it('projects the usage at reset, or when the limit is hit before it', () => {
    // 20% after 2 of 5 hours: 50% by reset.
    expect(pace(20, 2 * H, 5 * H, 3 * H)).toEqual({ text: '≈50% by reset', level: 'normal' });
    expect(pace(32, 2 * H, 5 * H, 3 * H)).toEqual({ text: '≈80% by reset', level: 'warn' });
    // 60% after 2 hours: 100% after 3h 20m, 1h 20m from now, before the reset in 3h.
    expect(pace(60, 2 * H, 5 * H, 3 * H)).toEqual({ text: 'Limit in ≈1h 20m', level: 'high' });
    expect(pace(100, 2 * H, 5 * H, 3 * H)).toEqual({ text: 'Limit reached', level: 'high' });
  });

  it('is too early to tell in the first tenth of the window', () => {
    expect(pace(5, 0.4 * H, 5 * H, 4.6 * H)).toEqual({ text: 'Too early to tell', level: 'normal' });
  });
});

const usage = (over: Partial<ClaudeUsage> = {}): ClaudeUsage => ({
  fiveHour: { percent: 42.4, resetsAt: at(2026, 11, 24, 15, 10) },
  week: { percent: 91, resetsAt: at(2026, 11, 28, 9, 0) },
  updatedAt: NOW - 3 * 60_000,
  ...over,
});

describe('UsageMeter', () => {
  it('shows both windows with percent and time left; the fill color follows the percent', () => {
    render(<UsageMeter usage={usage()} now={NOW} />);
    const items = screen.getAllByTestId('usage-window');
    expect(items.map((item) => item.textContent)).toEqual(['5h42%3h 10m', 'Week91%3d 21h']);
    expect(items.map((item) => item.dataset.level)).toEqual(['normal', 'high']);
    expect(screen.queryByTestId('usage-panel')).toBeNull();
  });

  it('hovering opens a panel with every detail; leaving closes it', () => {
    vi.useFakeTimers();
    render(<UsageMeter usage={usage()} now={NOW} />);
    fireEvent.mouseEnter(screen.getByTestId('usage'));
    act(() => vi.advanceTimersByTime(200));
    const details = screen.getAllByTestId('usage-detail');
    // 5 hours ending 15:10: 1h 50m in. 42.4% so far reaches 100% in ≈2h 29m, before the reset.
    expect(details[0]!.textContent).toBe('5-hour limit42% usedResetsToday 15:10 · in 3h 10mElapsed1h 50m of 5h · 37%PaceLimit in ≈2h 29m');
    expect(details[1]!.textContent).toBe('Weekly limit91% usedResetsSat 28 Nov 09:00 · in 3d 21hElapsed3d 3h of 7d · 45%PaceLimit in ≈7h 25m');
    expect(screen.getByTestId('usage-panel').textContent).toContain('updated 3m ago');
    fireEvent.mouseLeave(screen.getByTestId('usage'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId('usage-panel')).toBeNull();
  });

  it('70 to 89 is a warning; over 100% draws as 100 but the text keeps the value', () => {
    render(<UsageMeter usage={usage({ fiveHour: { percent: 75, resetsAt: NOW + 1000 }, week: { percent: 104, resetsAt: NOW + 1000 } })} now={NOW} />);
    const items = screen.getAllByTestId('usage-window');
    expect(items.map((item) => item.dataset.level)).toEqual(['warn', 'high']);
    expect(items[1]!.textContent).toContain('104%');
    expect((items[1]!.querySelector('.usage-fill') as HTMLElement).style.width).toBe('100%');
  });

  it('shows nothing without data; a window not running, or past its reset time, is at 0% with no countdown', () => {
    const { container } = render(<UsageMeter usage={null} now={NOW} />);
    expect(container.textContent).toBe('');
    cleanup();
    render(<UsageMeter usage={usage({ fiveHour: null })} now={NOW} />);
    let items = screen.getAllByTestId('usage-window');
    expect(items.map((item) => item.textContent)).toEqual(['5h0%', 'Week91%3d 21h']);
    expect(items[0]!.dataset.running).toBe('false');
    expect((items[0]!.querySelector('.usage-fill') as HTMLElement).style.width).toBe('0%');
    cleanup();
    render(<UsageMeter usage={usage({ fiveHour: { percent: 50, resetsAt: NOW - 1 } })} now={NOW} />);
    items = screen.getAllByTestId('usage-window');
    expect(items.map((item) => item.textContent)).toEqual(['5h0%', 'Week91%3d 21h']);
  });

  it("the panel says a window that isn't running starts with the next message", () => {
    vi.useFakeTimers();
    render(<UsageMeter usage={usage({ fiveHour: null })} now={NOW} />);
    fireEvent.mouseEnter(screen.getByTestId('usage'));
    act(() => vi.advanceTimersByTime(200));
    const details = screen.getAllByTestId('usage-detail');
    expect(details[0]!.textContent).toBe('5-hour limit0% usedStartswith your next message');
    expect(details[1]!.textContent).toContain('Weekly limit91% used');
  });
});
