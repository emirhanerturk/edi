import { useEffect, useState } from 'react';

/** Şimdiki an; `everyMs`'de bir yenilenir. Göreli zaman yazıları için. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
