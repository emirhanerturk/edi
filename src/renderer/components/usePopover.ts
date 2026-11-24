import { type RefObject, useEffect, useRef, useState } from 'react';

/** Açılır menü durumu: dışarı tıklayınca ve Escape ile kapanır. `ref`, düğmeyi ve menüyü saran öğeye verilir. */
export function usePopover<T extends HTMLElement>(): { open: boolean; setOpen(open: boolean): void; ref: RefObject<T | null> } {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}
