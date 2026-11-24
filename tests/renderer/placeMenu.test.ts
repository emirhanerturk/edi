import { describe, expect, it } from 'vitest';
import { placeMenu } from '../../src/renderer/components/placeMenu';

const viewport = { width: 1440, height: 900 };
const size = { width: 380, maxHeight: 360 };

describe('placeMenu', () => {
  it('düğmenin altına, sağ kenarına hizalı açılır', () => {
    const anchor = { left: 1180, right: 1260, top: 100, bottom: 124 };
    expect(placeMenu(anchor, viewport, size)).toEqual({ left: 880, top: 128, width: 380, maxHeight: 360 });
  });

  it('sola taşacaksa pencerenin içinde kalır', () => {
    const narrow = { width: 900, height: 700 };
    const anchor = { left: 240, right: 330, top: 100, bottom: 124 };
    expect(placeMenu(anchor, narrow, size).left).toBe(8);
  });

  it('sağa taşacaksa pencerenin içinde kalır', () => {
    const anchor = { left: 1380, right: 1436, top: 100, bottom: 124 };
    expect(placeMenu(anchor, viewport, size).left).toBe(1440 - 380 - 8);
  });

  it('altta yer azsa yüksekliği kısılır', () => {
    const anchor = { left: 1180, right: 1260, top: 500, bottom: 524 };
    expect(placeMenu(anchor, viewport, size)).toEqual({ left: 880, top: 528, width: 380, maxHeight: 360 });
    const lower = { left: 1180, right: 1260, top: 620, bottom: 644 };
    expect(placeMenu(lower, viewport, size)).toEqual({ left: 880, top: 648, width: 380, maxHeight: 244 });
  });

  it('altta çok az, üstte daha çok yer varsa yukarı açılır', () => {
    const anchor = { left: 1180, right: 1260, top: 800, bottom: 824 };
    // Altta 64, üstte 788 piksel var: menü düğmenin üstüne, alt kenarı düğmenin tepesine gelecek şekilde.
    expect(placeMenu(anchor, viewport, size)).toEqual({ left: 880, bottom: 104, width: 380, maxHeight: 360 });
  });

  it('pencereden geniş olamaz', () => {
    const tiny = { width: 300, height: 700 };
    const anchor = { left: 200, right: 260, top: 100, bottom: 124 };
    expect(placeMenu(anchor, tiny, size)).toMatchObject({ left: 8, width: 284 });
  });
});
