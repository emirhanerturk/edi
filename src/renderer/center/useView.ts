import { useEffect, useRef, useState } from 'react';

/** The first result (no previous one) isn't compared: no point serializing large data for nothing. */
const same = (a: unknown, b: unknown) => a === b || (a !== null && JSON.stringify(a) === JSON.stringify(b));

/**
 * Loads a view's data. When `key` changes, the old data goes away at once and the new data loads;
 * when `refreshToken` changes, it reloads quietly (the old data stays until the new arrives).
 * Late results are dropped: a result for another key, or a stale result arriving after a newer
 * load, isn't written to the screen. If the content didn't change, the same object stays.
 */
export function useView<T>(key: string, load: () => Promise<T>, refreshToken: unknown): { data: T | null; loading: boolean } {
  const [state, setState] = useState<{ key: string; data: T | null }>({ key, data: null });
  const latest = useRef({ key, load, started: 0, applied: 0 });
  latest.current.load = load;
  if (latest.current.key !== key) latest.current = { key, load, started: 0, applied: 0 };

  useEffect(() => {
    const run = latest.current;
    const order = ++run.started;
    void run.load().then(
      (data) => {
        // If the key changed, `latest.current` is a different object.
        if (latest.current !== run || order < run.applied) return;
        run.applied = order;
        setState((prev) => (prev.key === key && same(prev.data, data) ? prev : { key, data }));
      },
      () => undefined, // Bridge error: the current data stays, the next refresh tries again.
    );
  }, [key, refreshToken]);

  const data = state.key === key ? state.data : null;
  return { data, loading: data === null };
}

/** A counter that goes up whenever one of the given values changes: turns several things into a single refresh signal. */
export function useVersion(...values: unknown[]): number {
  const ref = useRef({ version: 0, values });
  if (values.length !== ref.current.values.length || values.some((value, index) => !Object.is(value, ref.current.values[index]))) {
    ref.current = { version: ref.current.version + 1, values };
  }
  return ref.current.version;
}
