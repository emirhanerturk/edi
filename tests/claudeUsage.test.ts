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
  it('5 saatlik ve haftalık pencereyi yüzde ve milisaniye cinsinden sıfırlanma anıyla verir', () => {
    expect(parseUsage(limits(), NOW - 60_000, NOW)).toEqual({
      fiveHour: { percent: 42.4, resetsAt: sec(NOW + 3 * 3600_000) * 1000 },
      week: { percent: 18, resetsAt: sec(NOW + 4 * 86400_000) * 1000 },
      updatedAt: NOW - 60_000,
    });
  });

  it('sıfırlanma anı geçmiş pencere düşer; ikisi de yoksa null', () => {
    const past = { used_percentage: 99, resets_at: sec(NOW - 1000) };
    expect(parseUsage(limits({ five_hour: past }), NOW, NOW)).toMatchObject({ fiveHour: null, week: { percent: 18 } });
    expect(parseUsage(limits({ five_hour: past, seven_day: past }), NOW, NOW)).toBeNull();
  });

  it('bozuk ya da eksik veride null; sayı olmayan alanlı pencere düşer; %100 üstü korunur', () => {
    expect(parseUsage('bozuk', NOW, NOW)).toBeNull();
    expect(parseUsage('null', NOW, NOW)).toBeNull();
    expect(parseUsage('{}', NOW, NOW)).toBeNull();
    const text = limits({ five_hour: { used_percentage: '42', resets_at: sec(NOW + 1000) }, seven_day: { used_percentage: 104, resets_at: sec(NOW + 1000) } });
    expect(parseUsage(text, NOW, NOW)).toMatchObject({ fiveHour: null, week: { percent: 104 } });
  });
});

describe('readUsage', () => {
  it('dosyayı okur, güncellenme anı dosyanın değişme zamanıdır; dosya yoksa null', async () => {
    const dir = await makeTmpDir();
    const file = join(dir, 'claude-usage.json');
    expect(await readUsage(file, NOW)).toBeNull();
    await writeFile(file, limits());
    await utimes(file, new Date(NOW - 120_000), new Date(NOW - 120_000));
    expect(await readUsage(file, NOW)).toMatchObject({ fiveHour: { percent: 42.4 }, updatedAt: NOW - 120_000 });
    await mkdir(join(dir, 'klasor'));
    expect(await readUsage(join(dir, 'klasor'), NOW)).toBeNull();
  });

  it('64 KB üstü dosyayı okumaz', async () => {
    const file = join(await makeTmpDir(), 'claude-usage.json');
    await writeFile(file, limits() + ' '.repeat(70_000));
    expect(await readUsage(file, NOW)).toBeNull();
  });
});

describe('usageFile', () => {
  it("EDI_USAGE_FILE yoksa edi'nin Application Support klasöründe", () => {
    expect(usageFile({}, '/Users/x')).toBe('/Users/x/Library/Application Support/edi/claude-usage.json');
    expect(usageFile({ EDI_USAGE_FILE: '/tmp/u.json' }, '/Users/x')).toBe('/tmp/u.json');
  });
});
