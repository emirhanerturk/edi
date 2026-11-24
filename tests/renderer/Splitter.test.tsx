// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Splitter, clampWidths } from '../../src/renderer/components/Splitter';

afterEach(cleanup);

describe('clampWidths', () => {
  it('orta panel yokken sol, sağdan kalan her şeyi alır', () => {
    expect(clampWidths({ left: 492, right: 372, total: 1440 })).toEqual({ left: 1068, right: 372 });
  });

  it('sağ panel 300 pikselden dar olamaz', () => {
    expect(clampWidths({ left: 492, right: 120, total: 1440 })).toEqual({ left: 1140, right: 300 });
    expect(clampWidths({ left: 492, right: -50, total: 1440 })).toEqual({ left: 1140, right: 300 });
  });

  it('sol panele en az 320 piksel kalır', () => {
    expect(clampWidths({ left: 492, right: 900, total: 1000 })).toEqual({ left: 320, right: 680 });
  });

  it('pencere ikisine de yetmeyecek kadar darsa sağ panel en küçük genişliğinde kalır', () => {
    expect(clampWidths({ left: 492, right: 372, total: 500 })).toEqual({ left: 200, right: 300 });
  });

  it('kesirli ve sayı olmayan değerleri düzeltir', () => {
    expect(clampWidths({ left: 492, right: 400.6, total: 1440 })).toEqual({ left: 1039, right: 401 });
    expect(clampWidths({ left: 492, right: Number.NaN, total: 1440 })).toEqual({ left: 1140, right: 300 });
  });
});

describe('clampWidths, orta panel açıkken', () => {
  it('yer varken iki genişlik de korunur', () => {
    expect(clampWidths({ left: 492, right: 372, total: 1440, center: true })).toEqual({ left: 492, right: 372 });
  });

  it('orta panele en az 360 piksel kalır: önce sol panel daralır', () => {
    expect(clampWidths({ left: 800, right: 372, total: 1440, center: true })).toEqual({ left: 708, right: 372 });
    expect(clampWidths({ left: 492, right: 372, total: 1100, center: true })).toEqual({ left: 368, right: 372 });
  });

  it('sol en küçük genişliğine inince sağ panel daralır', () => {
    expect(clampWidths({ left: 492, right: 372, total: 1000, center: true })).toEqual({ left: 320, right: 320 });
    expect(clampWidths({ left: 492, right: 900, total: 1440, center: true })).toEqual({ left: 320, right: 760 });
  });

  it('hiçbiri en küçük genişliğinin altına inmez', () => {
    expect(clampWidths({ left: 100, right: 100, total: 1440, center: true })).toEqual({ left: 320, right: 300 });
    expect(clampWidths({ left: 492, right: 372, total: 700, center: true })).toEqual({ left: 320, right: 300 });
  });

  it('sayı olmayan sol genişlik en küçük değere düşer', () => {
    expect(clampWidths({ left: Number.NaN, right: 372, total: 1440, center: true })).toEqual({ left: 320, right: 372 });
  });
});

describe('Splitter', () => {
  function renderSplitter() {
    const handlers = { onStart: vi.fn(), onDrag: vi.fn(), onEnd: vi.fn() };
    render(<Splitter label="Resize the Git panel" {...handlers} />);
    return { ...handlers, bar: screen.getByRole('separator', { name: 'Resize the Git panel' }) };
  }

  it('sürüklerken başlangıçtan beri kayan mesafeyi bildirir, bırakınca biter', () => {
    const { onStart, onDrag, onEnd, bar } = renderSplitter();
    fireEvent.mouseDown(bar, { button: 0, clientX: 500 });
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.mouseMove(window, { clientX: 460 });
    expect(onDrag).toHaveBeenLastCalledWith(-40);
    fireEvent.mouseMove(window, { clientX: 530 });
    expect(onDrag).toHaveBeenLastCalledWith(30);
    fireEvent.mouseUp(window);
    expect(onEnd).toHaveBeenCalledTimes(1);

    fireEvent.mouseMove(window, { clientX: 300 }); // bırakıldıktan sonra izlemez
    expect(onDrag).toHaveBeenCalledTimes(2);
  });

  it('sağ tuşla sürükleme başlamaz', () => {
    const { onStart, onDrag, bar } = renderSplitter();
    fireEvent.mouseDown(bar, { button: 2, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(onStart).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it('ok tuşlarıyla 16 piksel kayar', () => {
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
