// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Splitter, clampWidths } from '../../src/renderer/components/Splitter';

afterEach(cleanup);

describe('clampWidths', () => {
  it('without a center panel, the left takes everything the right leaves', () => {
    expect(clampWidths({ left: 492, right: 372, total: 1440 })).toEqual({ left: 1068, right: 372 });
  });

  it('the right panel cannot be narrower than 300 px', () => {
    expect(clampWidths({ left: 492, right: 120, total: 1440 })).toEqual({ left: 1140, right: 300 });
    expect(clampWidths({ left: 492, right: -50, total: 1440 })).toEqual({ left: 1140, right: 300 });
  });

  it('the left panel keeps at least 320 px', () => {
    expect(clampWidths({ left: 492, right: 900, total: 1000 })).toEqual({ left: 320, right: 680 });
  });

  it('when the window is too narrow for both, the right panel stays at its minimum width', () => {
    expect(clampWidths({ left: 492, right: 372, total: 500 })).toEqual({ left: 200, right: 300 });
  });

  it('fixes fractional and non-numeric values', () => {
    expect(clampWidths({ left: 492, right: 400.6, total: 1440 })).toEqual({ left: 1039, right: 401 });
    expect(clampWidths({ left: 492, right: Number.NaN, total: 1440 })).toEqual({ left: 1140, right: 300 });
  });
});

describe('clampWidths with the center panel open', () => {
  it('keeps both widths when there is room', () => {
    expect(clampWidths({ left: 492, right: 372, total: 1440, center: true })).toEqual({ left: 492, right: 372 });
  });

  it('the center panel keeps at least 360 px: the left panel shrinks first', () => {
    expect(clampWidths({ left: 800, right: 372, total: 1440, center: true })).toEqual({ left: 708, right: 372 });
    expect(clampWidths({ left: 492, right: 372, total: 1100, center: true })).toEqual({ left: 368, right: 372 });
  });

  it('once the left is at its minimum width, the right panel shrinks', () => {
    expect(clampWidths({ left: 492, right: 372, total: 1000, center: true })).toEqual({ left: 320, right: 320 });
    expect(clampWidths({ left: 492, right: 900, total: 1440, center: true })).toEqual({ left: 320, right: 760 });
  });

  it('neither goes below its minimum width', () => {
    expect(clampWidths({ left: 100, right: 100, total: 1440, center: true })).toEqual({ left: 320, right: 300 });
    expect(clampWidths({ left: 492, right: 372, total: 700, center: true })).toEqual({ left: 320, right: 300 });
  });

  it('a non-numeric left width falls back to the minimum', () => {
    expect(clampWidths({ left: Number.NaN, right: 372, total: 1440, center: true })).toEqual({ left: 320, right: 372 });
  });
});

describe('Splitter', () => {
  function renderSplitter() {
    const handlers = { onStart: vi.fn(), onDrag: vi.fn(), onEnd: vi.fn() };
    render(<Splitter label="Resize the Git panel" {...handlers} />);
    return { ...handlers, bar: screen.getByRole('separator', { name: 'Resize the Git panel' }) };
  }

  it('while dragging, reports the distance moved since the start; ends on release', () => {
    const { onStart, onDrag, onEnd, bar } = renderSplitter();
    fireEvent.mouseDown(bar, { button: 0, clientX: 500 });
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.mouseMove(window, { clientX: 460 });
    expect(onDrag).toHaveBeenLastCalledWith(-40);
    fireEvent.mouseMove(window, { clientX: 530 });
    expect(onDrag).toHaveBeenLastCalledWith(30);
    fireEvent.mouseUp(window);
    expect(onEnd).toHaveBeenCalledTimes(1);

    fireEvent.mouseMove(window, { clientX: 300 }); // no tracking after release
    expect(onDrag).toHaveBeenCalledTimes(2);
  });

  it('the right mouse button does not start a drag', () => {
    const { onStart, onDrag, bar } = renderSplitter();
    fireEvent.mouseDown(bar, { button: 2, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(onStart).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it('arrow keys move it by 16 px', () => {
    const { onStart, onDrag, onEnd, bar } = renderSplitter();
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(onDrag).toHaveBeenLastCalledWith(-16);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(onDrag).toHaveBeenLastCalledWith(16);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(bar, { key: 'a' });
    expect(onDrag).toHaveBeenCalledTimes(2);
  });
});
