import { useEffect, useRef, useState } from 'react';

const MIN_LEFT = 320;
const MIN_RIGHT = 300;
/** Ok tuşuyla bir basışta kayılan mesafe. */
const KEY_STEP = 16;

const MIN_CENTER = 360;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Number.isFinite(value) ? Math.round(value) : min, max));

/**
 * Panel genişliklerini pencereye sığdırır. Sağ panel en az 300, sol en az 320 pikseldir.
 * Orta panel yokken sol panel sağdan kalan her şeyi alır. Orta panel açıkken ona en az 360
 * piksel kalır: önce sol panel daralır, o en küçük genişliğine inince sağ panel. Pencere
 * hepsine yetmiyorsa paneller en küçük genişliklerinde kalır.
 */
export function clampWidths(o: { left: number; right: number; total: number; center?: boolean }): { left: number; right: number } {
  if (!o.center) {
    const right = clamp(o.right, MIN_RIGHT, o.total - MIN_LEFT);
    return { left: o.total - right, right };
  }
  const right = clamp(o.right, MIN_RIGHT, o.total - MIN_LEFT - MIN_CENTER);
  return { left: clamp(o.left, MIN_LEFT, o.total - right - MIN_CENTER), right };
}

export interface SplitterProps {
  label: string;
  onStart(): void;
  /** Sürüklemenin başından beri yatay kayma (sağa doğru artı). */
  onDrag(dx: number): void;
  onEnd(): void;
}

/** İki panel arasındaki sürüklenebilir çizgi. Ok tuşlarıyla da kaydırılır. */
export function Splitter({ label, onStart, onDrag, onEnd }: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const handlers = useRef({ onDrag, onEnd });
  handlers.current = { onDrag, onEnd };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => handlers.current.onDrag(event.clientX - startX.current);
    const onUp = () => {
      setDragging(false);
      handlers.current.onEnd();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Sürüklerken imleç panellerin üstünde de aynı kalsın, metin seçilmesin.
    document.body.classList.add('resizing');
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
    };
  }, [dragging]);

  return (
    <div
      className={`splitter${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        startX.current = event.clientX;
        onStart();
        setDragging(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onStart();
        onDrag(event.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP);
        onEnd();
      }}
    />
  );
}
