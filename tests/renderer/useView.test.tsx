// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useView } from '../../src/renderer/center/useView';

afterEach(cleanup);

/** Dışarıdan çözülen sözler: yüklemelerin hangi sırayla biteceğini test belirler. */
function deferred() {
  const pending: { key: string; resolve(value: string): void; reject(error: Error): void }[] = [];
  const load = (key: string) => () => new Promise<string>((resolve, reject) => pending.push({ key, resolve, reject }));
  return { pending, load };
}
const settle = () => act(async () => undefined);

describe('useView', () => {
  it('yüklenene kadar veri yoktur, sonra gelir', async () => {
    const { pending, load } = deferred();
    const { result } = renderHook(() => useView('a', load('a'), 0));
    expect(result.current).toEqual({ data: null, loading: true });
    await act(async () => pending[0]!.resolve('A'));
    expect(result.current).toEqual({ data: 'A', loading: false });
  });

  it("A yüklenirken B'ye geçilirse A'nın geç gelen içeriği B'nin altında gösterilmez", async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ k }) => useView(k, load(k), 0), { initialProps: { k: 'a' } });
    rerender({ k: 'b' });
    expect(result.current.data).toBeNull();
    await act(async () => pending.find((p) => p.key === 'a')!.resolve('A'));
    expect(result.current).toEqual({ data: null, loading: true });
    await act(async () => pending.find((p) => p.key === 'b')!.resolve('B'));
    expect(result.current).toEqual({ data: 'B', loading: false });
  });

  it('anahtar değişince eski veri hemen kalkar', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ k }) => useView(k, load(k), 0), { initialProps: { k: 'a' } });
    await act(async () => pending[0]!.resolve('A'));
    rerender({ k: 'b' });
    expect(result.current).toEqual({ data: null, loading: true });
  });

  it('yenileme sessizdir: yenisi gelene kadar eski veri durur', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    await act(async () => pending[0]!.resolve('eski'));
    rerender({ t: 2 });
    expect(result.current).toEqual({ data: 'eski', loading: false });
    await act(async () => pending[1]!.resolve('yeni'));
    expect(result.current.data).toBe('yeni');
  });

  it('yavaş yükleme, araya giren yenilemeler yüzünden kaybolmaz', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    rerender({ t: 2 });
    rerender({ t: 3 });
    await act(async () => pending[0]!.resolve('ilk'));
    expect(result.current.data).toBe('ilk');
  });

  it('eski bir yenilemenin geç gelen sonucu yenisinin üstüne yazmaz', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    rerender({ t: 2 });
    await settle();
    await act(async () => pending[1]!.resolve('yeni'));
    await act(async () => pending[0]!.resolve('eski'));
    expect(result.current.data).toBe('yeni');
  });

  it('içerik aynıysa aynı nesne kalır (boşuna yeniden çizilmez)', async () => {
    const results = [{ n: 1 }, { n: 1 }, { n: 2 }];
    let call = 0;
    const load = () => Promise.resolve(results[call++]!);
    const { result, rerender } = renderHook(({ t }) => useView('a', load, t), { initialProps: { t: 1 } });
    await settle();
    const first = result.current.data;
    rerender({ t: 2 });
    await settle();
    expect(result.current.data).toBe(first);
    rerender({ t: 3 });
    await settle();
    expect(result.current.data).toEqual({ n: 2 });
  });

  it('yükleme hata verirse eldeki veri durur', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    await act(async () => pending[0]!.resolve('A'));
    rerender({ t: 2 });
    await act(async () => pending[1]!.reject(new Error('köprü koptu')));
    expect(result.current).toEqual({ data: 'A', loading: false });
  });
});
