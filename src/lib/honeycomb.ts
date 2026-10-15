// Pure geometry for the honeycomb: pointy-top hexagons, odd rows shifted half a tile, rows overlapping by a quarter.
// No React and no DOM, so every size rule is unit-tested.

/** Height of a pointy-top hexagon divided by its width. */
export const HEX_RATIO = 2 / Math.sqrt(3);
export const HEX_GAP = 4;
export const MAX_COLS = 4;
export const MIN_COLS = 2;
const SMALL_HW = 88;
const MAX_HW = 116;
/** Below this container width four tiles per row no longer fit at a readable size. */
const NARROW_BELOW = 420;
/** Used before the first measurement (and in test environments with no layout). */
export const FALLBACK_WIDTH = 480;

export interface HiveLayout {
  /** Hexagon width in px. */
  hw: number;
  cols: number;
  /** Whole hive size in px. Centre it in its container. */
  width: number;
  height: number;
  /** True when tiles are too small to carry a value line. */
  compact: boolean;
  positions: { left: number; top: number }[];
}

/**
 * Up to four tiles per row: eight tiles fill two interlocked rows and the ninth starts a third.
 * Narrow containers (a phone held upright) get smaller tiles and three per row, never fewer than two.
 */
export function hiveLayout(count: number, containerWidth: number): HiveLayout {
  const available = containerWidth > 0 ? containerWidth : FALLBACK_WIDTH;
  // Wide enough: exactly four per row, tiles sized to fill the width (4 tiles + half a tile of shift = 4.5 steps).
  // Narrower: small fixed tiles, as many as fit (three on most phones).
  const four = available >= NARROW_BELOW;
  const hw = four ? Math.min(MAX_HW, Math.floor(available / (MAX_COLS + 0.5)) - HEX_GAP) : SMALL_HW;
  const step = hw + HEX_GAP;
  const rowH = hw * HEX_RATIO * 0.75 + HEX_GAP;
  const cols = four ? MAX_COLS : Math.min(MAX_COLS, Math.max(MIN_COLS, Math.floor((available - step / 2) / step)));
  const rows = Math.ceil(count / cols);
  const positions = Array.from({ length: count }, (_, i) => ({
    left: (i % cols) * step + (Math.floor(i / cols) % 2) * (step / 2),
    top: Math.floor(i / cols) * rowH,
  }));
  return {
    hw,
    cols,
    width: cols * step + step / 2,
    height: rows === 0 ? 0 : (rows - 1) * rowH + hw * HEX_RATIO,
    compact: hw < 100,
    positions,
  };
}
