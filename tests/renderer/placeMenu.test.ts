import { describe, expect, it } from 'vitest';
import { placeMenu } from '../../src/renderer/components/placeMenu';

const viewport = { width: 1440, height: 900 };
const size = { width: 380, maxHeight: 360 };

describe('placeMenu', () => {
  it('opens below the button, aligned to its right edge', () => {
    const anchor = { left: 1180, right: 1260, top: 100, bottom: 124 };
    expect(placeMenu(anchor, viewport, size)).toEqual({ left: 880, top: 128, width: 380, maxHeight: 360 });
  });

  it('stays inside the window when it would overflow on the left', () => {
    const narrow = { width: 900, height: 700 };
    const anchor = { left: 240, right: 330, top: 100, bottom: 124 };
    expect(placeMenu(anchor, narrow, size).left).toBe(8);
  });

  it('stays inside the window when it would overflow on the right', () => {
    const anchor = { left: 1380, right: 1436, top: 100, bottom: 124 };
    expect(placeMenu(anchor, viewport, size).left).toBe(1440 - 380 - 8);
  });

  it('shrinks its height when there is little room below', () => {
    const anchor = { left: 1180, right: 1260, top: 500, bottom: 524 };
    expect(placeMenu(anchor, viewport, size)).toEqual({ left: 880, top: 528, width: 380, maxHeight: 360 });
    const lower = { left: 1180, right: 1260, top: 620, bottom: 644 };
    expect(placeMenu(lower, viewport, size)).toEqual({ left: 880, top: 648, width: 380, maxHeight: 244 });
  });

  it('opens upward when there is very little room below and more above', () => {
    const anchor = { left: 1180, right: 1260, top: 800, bottom: 824 };
    // 64 px below, 788 px above: the menu sits above the button, its bottom edge at the button's top.
    expect(placeMenu(anchor, viewport, size)).toEqual({ left: 880, bottom: 104, width: 380, maxHeight: 360 });
  });

  it('cannot be wider than the window', () => {
    const tiny = { width: 300, height: 700 };
    const anchor = { left: 200, right: 260, top: 100, bottom: 124 };
    expect(placeMenu(anchor, tiny, size)).toMatchObject({ left: 8, width: 284 });
  });
});
