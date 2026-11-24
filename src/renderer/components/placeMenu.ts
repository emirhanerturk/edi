export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Pencereye göre sabit konum: `top` ya da (yukarı açılıyorsa) `bottom` dolu gelir. */
export interface Placement {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** Menü ile düğme arasındaki boşluk ve menünün pencere kenarına en fazla yaklaşacağı mesafe. */
const GAP = 4;
const MARGIN = 8;
/** Altta bundan az yer varsa ve üstte daha çok yer varsa menü yukarı açılır. */
const MIN_BELOW = 200;

/**
 * Açılır menüyü düğmenin altına, sağ kenarına hizalı yerleştirir ve pencerenin içinde tutar.
 * Menü `position: fixed` ile çizilir; böylece kaydırılabilir bir panelin içinde açılsa da
 * panelin kenarında kırpılmaz.
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
