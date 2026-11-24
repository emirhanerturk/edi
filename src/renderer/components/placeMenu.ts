export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Fixed position relative to the window: `top` or (if opening upward) `bottom` is set. */
export interface Placement {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** Gap between the menu and the button, and the closest the menu gets to the window edge. */
const GAP = 4;
const MARGIN = 8;
/** If there's less room than this below and more room above, the menu opens upward. */
const MIN_BELOW = 200;

/**
 * Places a dropdown menu below the button, aligned to its right edge, and keeps it inside the window.
 * The menu is drawn with `position: fixed`, so even when opened inside a scrollable panel it isn't
 * clipped at the panel's edge.
 */
export function placeMenu(anchor: Box, viewport: { width: number; height: number }, size: { width: number; maxHeight: number }): Placement {
  const width = Math.min(size.width, viewport.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(anchor.right - width, viewport.width - MARGIN - width));
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  if (below >= MIN_BELOW || below >= above) {
    return { left, top: anchor.bottom + GAP, width, maxHeight: Math.max(0, Math.min(size.maxHeight, below)) };
  }
  return { left, bottom: viewport.height - anchor.top + GAP, width, maxHeight: Math.max(0, Math.min(size.maxHeight, above)) };
}
