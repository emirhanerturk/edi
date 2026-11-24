import { useEffect, useRef, useState } from 'react';

const MIN_LEFT = 320;
const MIN_RIGHT = 300;
/** Ok tuşuyla bir basışta kayılan mesafe. */
const KEY_STEP = 16;

/**
 * Panel genişliklerini pencereye sığdırır. Orta panel yokken sol panel, sağdan kalan her şeyi
 * alır; sağ panel en az 300, sol en az 320 pikseldir. Pencere ikisine yetmiyorsa sağ panel
 * en küçük genişliğinde kalır.
 */
export function clampWidths(o: { left: number; right: number; total: number }): { left: number; right: number } {
  const wanted = Number.isFinite(o.right) ? Math.round(o.right) : MIN_RIGHT;
  const right = Math.max(MIN_RIGHT, Math.min(wanted, o.total - MIN_LEFT));
  return { left: o.total - right, right };
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
