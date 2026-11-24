// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UsageMeter, resetText } from '../../src/renderer/components/UsageMeter';
import type { ClaudeUsage } from '../../src/shared/api';

afterEach(cleanup);

// Local time: the tests are written against local time, not TZ=UTC, and build their instants in local time.
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 24, 12, 0);

describe('resetText', () => {
  it('only the time when today, otherwise day, date and time', () => {
    expect(resetText(at(2026, 11, 24, 15, 10), NOW)).toBe('15:10');
    expect(resetText(at(2026, 11, 25, 9, 5), NOW)).toBe('Wed 25 Nov 09:05');
    expect(resetText(at(2026, 11, 28, 0, 0), NOW)).toBe('Sat 28 Nov 00:00');
  });
});

const usage = (over: Partial<ClaudeUsage> = {}): ClaudeUsage => ({
  fiveHour: { percent: 42.4, resetsAt: at(2026, 11, 24, 15, 10) },
  week: { percent: 91, resetsAt: at(2026, 11, 28, 9, 0) },
  updatedAt: NOW - 3 * 60_000,
  ...over,
});

describe('UsageMeter', () => {
  it('shows both windows with percent and reset time; the fill color follows the percent', () => {
    render(<UsageMeter usage={usage()} now={NOW} />);
    const items = screen.getAllByTestId('usage-window');
    expect(items.map((item) => item.textContent)).toEqual(['5h42%15:10', 'Week91%Sat 28 Nov 09:00']);
    expect(items.map((item) => item.dataset.level)).toEqual(['normal', 'high']);
    expect(items[0]!.title).toBe('5-hour limit: 42% used · resets 15:10 · updated 3m ago');
    expect(items[1]!.title).toBe('Weekly limit: 91% used · resets Sat 28 Nov 09:00 · updated 3m ago');
  });

  it('70 to 89 is a warning; over 100% draws as 100 but the text keeps the value', () => {
    render(<UsageMeter usage={usage({ fiveHour: { percent: 75, resetsAt: NOW + 1000 }, week: { percent: 104, resetsAt: NOW + 1000 } })} now={NOW} />);
    const items = screen.getAllByTestId('usage-window');
    expect(items.map((item) => item.dataset.level)).toEqual(['warn', 'high']);
    expect(items[1]!.textContent).toContain('104%');
    expect((items[1]!.querySelector('.usage-fill') as HTMLElement).style.width).toBe('100%');
  });

  it('hides a window when there is no data or its reset time has passed', () => {
    const { container } = render(<UsageMeter usage={null} now={NOW} />);
    expect(container.textContent).toBe('');
    cleanup();
    render(<UsageMeter usage={usage({ fiveHour: { percent: 50, resetsAt: NOW - 1 } })} now={NOW} />);
    expect(screen.getAllByTestId('usage-window').map((item) => item.textContent)).toEqual(['Week91%Sat 28 Nov 09:00']);
  });
});
