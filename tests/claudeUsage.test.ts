import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUsage, readUsage, usageFile } from '../src/main/claudeUsage.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const sec = (ms: number) => Math.floor(ms / 1000);
const limits = (over: object = {}) =>
  JSON.stringify({
    five_hour: { used_percentage: 42.4, resets_at: sec(NOW + 3 * 3600_000) },
    seven_day: { used_percentage: 18, resets_at: sec(NOW + 4 * 86400_000) },
    ...over,
  });

describe('parseUsage', () => {
  it('returns the 5-hour and weekly windows as a percentage with the reset time in milliseconds', () => {
    expect(parseUsage(limits(), NOW - 60_000, NOW)).toEqual({
      fiveHour: { percent: 42.4, resetsAt: sec(NOW + 3 * 3600_000) * 1000 },
      week: { percent: 18, resetsAt: sec(NOW + 4 * 86400_000) * 1000 },
      updatedAt: NOW - 60_000,
    });
  });

  it('a window past its reset time, or not reported, is not running (null), and the other one is kept', () => {
    const past = { used_percentage: 99, resets_at: sec(NOW - 1000) };
    expect(parseUsage(limits({ five_hour: past }), NOW, NOW)).toMatchObject({ fiveHour: null, week: { percent: 18 } });
    expect(parseUsage(limits({ five_hour: past, seven_day: past }), NOW, NOW)).toEqual({ fiveHour: null, week: null, updatedAt: NOW });
    const { five_hour: _five, ...weekOnly } = JSON.parse(limits()) as Record<string, unknown>;
    expect(parseUsage(JSON.stringify(weekOnly), NOW, NOW)).toMatchObject({ fiveHour: null, week: { percent: 18 } });
  });

  it('returns null on broken or missing data, drops a window with non-numeric fields and keeps values over 100%', () => {
    expect(parseUsage('broken', NOW, NOW)).toBeNull();
    expect(parseUsage('null', NOW, NOW)).toBeNull();
    expect(parseUsage('{}', NOW, NOW)).toBeNull();
    const text = limits({ five_hour: { used_percentage: '42', resets_at: sec(NOW + 1000) }, seven_day: { used_percentage: 104, resets_at: sec(NOW + 1000) } });
    expect(parseUsage(text, NOW, NOW)).toMatchObject({ fiveHour: null, week: { percent: 104 } });
  });
});

describe('readUsage', () => {
  it('reads the file, uses its modification time as the update time and returns null when it is missing', async () => {
    const dir = await makeTmpDir();
    const file = join(dir, 'claude-usage.json');
    expect(await readUsage(file, NOW)).toBeNull();
    await writeFile(file, limits());
    await utimes(file, new Date(NOW - 120_000), new Date(NOW - 120_000));
    expect(await readUsage(file, NOW)).toMatchObject({ fiveHour: { percent: 42.4 }, updatedAt: NOW - 120_000 });
    await mkdir(join(dir, 'folder'));
    expect(await readUsage(join(dir, 'folder'), NOW)).toBeNull();
  });

  it('does not read a file over 64 KB', async () => {
    const file = join(await makeTmpDir(), 'claude-usage.json');
    await writeFile(file, limits() + ' '.repeat(70_000));
    expect(await readUsage(file, NOW)).toBeNull();
  });
});

describe('usageFile', () => {
  it("lives in edi's Application Support folder unless EDI_USAGE_FILE is set", () => {
    expect(usageFile({}, '/Users/x')).toBe('/Users/x/Library/Application Support/edi/claude-usage.json');
    expect(usageFile({ EDI_USAGE_FILE: '/tmp/u.json' }, '/Users/x')).toBe('/tmp/u.json');
  });
});
