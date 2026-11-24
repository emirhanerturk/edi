import { useEffect, useRef, useState } from 'react';

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Bir görünümün verisini yükler. `key` değişince eski veri hemen kalkar ve yenisi yüklenir;
 * `refreshToken` değişince sessizce yeniden yüklenir (yenisi gelene kadar eskisi durur).
 * Geç gelen sonuçlar atılır: başka bir anahtarın sonucu ya da daha yeni bir yüklemenin
 * arkasından gelen eski sonuç ekrana yazılmaz. İçerik değişmediyse aynı nesne kalır.
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
        // Anahtar değiştiyse `latest.current` başka bir nesnedir.
        if (latest.current !== run || order < run.applied) return;
        run.applied = order;
        setState((prev) => (prev.key === key && same(prev.data, data) ? prev : { key, data }));
      },
      () => undefined, // Köprü hatası: eldeki veri durur, bir sonraki yenileme yeniden dener.
    );
  }, [key, refreshToken]);

  const data = state.key === key ? state.data : null;
  return { data, loading: data === null };
}

/** Verilen değerlerden biri değiştikçe artan sayaç: birden çok şeyi tek yenileme işareti yapar. */
export function useVersion(...values: unknown[]): number {
  const ref = useRef({ version: 0, values });
  if (values.length !== ref.current.values.length || values.some((value, index) => !Object.is(value, ref.current.values[index]))) {
    ref.current = { version: ref.current.version + 1, values };
  }
  return ref.current.version;
}
