import { useEffect, useRef, useState } from 'react';

const MIN_LEFT = 320;
const MIN_RIGHT = 300;
/** Distance moved per arrow key press. */
const KEY_STEP = 16;

const MIN_CENTER = 360;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Number.isFinite(value) ? Math.round(value) : min, max));

/**
 * Fits the panel widths to the window. The right panel is at least 300 px, the left at least 320.
 * Without the center panel, the left panel takes everything the right leaves. With the center panel
 * open, it keeps at least 360 px: the left panel shrinks first, then the right once the left hits its
 * minimum width. If the window can't fit them all, the panels stay at their minimum widths.
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
  /** Horizontal offset since the drag started (positive to the right). */
  onDrag(dx: number): void;
  onEnd(): void;
}

/** Draggable line between two panels. Can also be moved with the arrow keys. */
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
    // While dragging, keep the cursor the same over the panels and don't select text.
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
