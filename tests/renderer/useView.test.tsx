// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useView } from '../../src/renderer/center/useView';

afterEach(cleanup);

/** Promises resolved from outside: the test decides the order in which loads finish. */
function deferred() {
  const pending: { key: string; resolve(value: string): void; reject(error: Error): void }[] = [];
  const load = (key: string) => () => new Promise<string>((resolve, reject) => pending.push({ key, resolve, reject }));
  return { pending, load };
}
const settle = () => act(async () => undefined);

describe('useView', () => {
  it('has no data until loaded, then has it', async () => {
    const { pending, load } = deferred();
    const { result } = renderHook(() => useView('a', load('a'), 0));
    expect(result.current).toEqual({ data: null, loading: true });
    await act(async () => pending[0]!.resolve('A'));
    expect(result.current).toEqual({ data: 'A', loading: false });
  });

  it("switching to B while A loads does not show A's late content under B", async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ k }) => useView(k, load(k), 0), { initialProps: { k: 'a' } });
    rerender({ k: 'b' });
    expect(result.current.data).toBeNull();
    await act(async () => pending.find((p) => p.key === 'a')!.resolve('A'));
    expect(result.current).toEqual({ data: null, loading: true });
    await act(async () => pending.find((p) => p.key === 'b')!.resolve('B'));
    expect(result.current).toEqual({ data: 'B', loading: false });
  });

  it('drops the old data as soon as the key changes', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ k }) => useView(k, load(k), 0), { initialProps: { k: 'a' } });
    await act(async () => pending[0]!.resolve('A'));
    rerender({ k: 'b' });
    expect(result.current).toEqual({ data: null, loading: true });
  });

  it('a refresh is silent: the old data stays until the new data arrives', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    await act(async () => pending[0]!.resolve('old'));
    rerender({ t: 2 });
    expect(result.current).toEqual({ data: 'old', loading: false });
    await act(async () => pending[1]!.resolve('new'));
    expect(result.current.data).toBe('new');
  });

  it('a slow load is not lost to refreshes that come in between', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    rerender({ t: 2 });
    rerender({ t: 3 });
    await act(async () => pending[0]!.resolve('first'));
    expect(result.current.data).toBe('first');
  });

  it("a stale refresh's late result does not overwrite the newer one", async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    rerender({ t: 2 });
    await settle();
    await act(async () => pending[1]!.resolve('new'));
    await act(async () => pending[0]!.resolve('old'));
    expect(result.current.data).toBe('new');
  });

  it('keeps the same object when the content is unchanged (no needless re-render)', async () => {
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

  it('does not compare the first result (a big commit is not stringified twice)', async () => {
    const big = { files: Array.from({ length: 50 }, (_, i) => ({ path: `f${i}` })) };
    const { result } = renderHook(() => useView('a', () => Promise.resolve(big), 0));
    const stringify = vi.spyOn(JSON, 'stringify');
    await settle();
    expect(result.current.data).toBe(big);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it('keeps the current data when a load fails', async () => {
    const { pending, load } = deferred();
    const { result, rerender } = renderHook(({ t }) => useView('a', load('a'), t), { initialProps: { t: 1 } });
    await act(async () => pending[0]!.resolve('A'));
    rerender({ t: 2 });
    await act(async () => pending[1]!.reject(new Error('bridge lost')));
    expect(result.current).toEqual({ data: 'A', loading: false });
  });
});
