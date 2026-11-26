// Reordering a tab bar by dragging a tab: where it lands, the line that says so, and the handlers. Used by
// the terminal tab bar and the center panel's.
import { type DragEvent, useState } from 'react';

export type Side = 'before' | 'after';

/** Which half of the tab the pointer is over: the left half drops before it, the right half after. */
export function dropSide(clientX: number, box: { left: number; width: number }): Side {
  return clientX < box.left + box.width / 2 ? 'before' : 'after';
}

/** Where `id` lands when dropped before or after `target`: its index once moved (its own index if either is missing). */
export function dropIndex<T>(ids: readonly T[], id: T, target: T, side: Side): number {
  const from = ids.indexOf(id);
  const at = ids.indexOf(target);
  if (from === -1 || at === -1) return from;
  const to = at + (side === 'after' ? 1 : 0);
  return from < to ? to - 1 : to;
}

/** The items with the one at `from` moved to `to` (its index once moved); the same array when nothing moves. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const index = Math.max(0, Math.min(to, items.length - 1));
  if (from < 0 || from >= items.length || index === from) return items as T[];
  const rest = items.filter((_, at) => at !== from);
  return [...rest.slice(0, index), items[from]!, ...rest.slice(index)];
}

export interface TabDragProps {
  draggable: true;
  onDragStart(event: DragEvent<HTMLElement>): void;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
}

export interface TabDrag<T> {
  /** A tab's drag handlers. */
  tab(id: T): TabDragProps;
  /** The classes a tab adds: `dragging` while it is held, `drop-before` / `drop-after` where the held one would land. */
  classes(id: T): string;
  /** The whole bar's handlers: past the last tab, the held one goes to the end. */
  bar: {
    onDragOver(event: DragEvent<HTMLElement>): void;
    onDragLeave(event: DragEvent<HTMLElement>): void;
    onDrop(event: DragEvent<HTMLElement>): void;
  };
}

/**
 * Drag to reorder a tab bar. `type` names what a held tab carries: only a bar of the same type takes it, and
 * a terminal never takes it as pasted text. `onMove` gets the tab and its index once moved. The line shows
 * only where dropping would change the order; a drop elsewhere, or Esc, changes nothing.
 */
export function useTabDrag<T extends string | number>(ids: readonly T[], type: string, onMove: (id: T, index: number) => void): TabDrag<T> {
  const [dragging, setDragging] = useState<T | null>(null);
  const [over, setOver] = useState<{ id: T; side: Side } | null>(null);

  const from = dragging === null ? -1 : ids.indexOf(dragging);
  const to = dragging === null || over === null ? -1 : dropIndex(ids, dragging, over.id, over.side);
  const line = from !== -1 && to !== -1 && to !== from ? over : null;

  const end = () => {
    setDragging(null);
    setOver(null);
  };
  const accept = (event: DragEvent<HTMLElement>) => {
    if (dragging === null || !event.dataTransfer.types.includes(type)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    return true;
  };
  const point = (id: T, side: Side) => {
    if (over?.id !== id || over.side !== side) setOver({ id, side });
  };

  return {
    tab: (id) => ({
      draggable: true,
      onDragStart(event) {
        event.dataTransfer.setData(type, String(id));
        event.dataTransfer.effectAllowed = 'move';
        setDragging(id);
      },
      onDragOver(event) {
        if (accept(event)) point(id, dropSide(event.clientX, event.currentTarget.getBoundingClientRect()));
      },
      onDragEnd: end,
    }),
    classes: (id) => `${id === dragging ? ' dragging' : ''}${line?.id === id ? ` drop-${line.side}` : ''}`,
    bar: {
      onDragOver(event) {
        // Over a tab, the tab's own handler says where.
        if ((event.target as HTMLElement).closest('[draggable="true"]') || !accept(event)) return;
        const last = ids.at(-1);
        if (last !== undefined) point(last, 'after');
      },
      onDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
      },
      onDrop(event) {
        if (dragging === null) return;
        event.preventDefault();
        if (line !== null) onMove(dragging, to);
        end();
      },
    },
  };
}
