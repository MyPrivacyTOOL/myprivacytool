// Pure geometry for the climbing footprint trail (no React, no DOM, so every rule is unit-tested).
// Design agreed with Chris 2026-11-07 (Notion: MPC-9546 strategy page, "Design direction, final version"):
//  - the honeycomb rows alternate 2 and 3 tiles, bottom row first (2, 3, 2, 3, 2 = 12 tiles), so a group is about 3 hexagons wide
//  - ONE trail of alternating left and right prints that only ever moves UP the screen, swaying 2 to 3 hexagons wide
//  - a print is coloured by the risk of the data under it: black = no risk, then dark red, brighter red, brightest red
//  - a tile is darker green the more prints land on it; tiles beside the trail stay light green
import { HEX_RATIO, HEX_GAP } from './honeycomb';

export type Sensitivity = 'low' | 'medium' | 'high';
/** What we know about one tile. Only a deleted tile ever disappears. */
export type TileState = 'notyet' | 'clear' | 'cant' | 'held' | 'deleting' | 'gone';
export type PrintLevel = 'none' | Sensitivity;

export const MIN_HW = 84;
export const MAX_HW = 170;
/** Below this tile width the small caption ("we hold it · medium") no longer fits inside the tile, so it is dropped. */
export const COMPACT_BELOW = 130;
export const FALLBACK_WIDTH = 480;

export interface TrailLayout {
  hw: number;
  hh: number;
  compact: boolean;
  /** Centre of each tile, in the order given (bottom row first, left to right). */
  centres: { x: number; y: number }[];
  /** Tiles per row, bottom row first. */
  rowLens: number[];
  width: number;
  height: number;
  /** Where the trail starts and ends (below and above the honeycomb). */
  yStart: number;
  yEnd: number;
  xMid: number;
}

/** Row lengths for `count` tiles: 2, 3, 2, 3 ... from the bottom. The last row may be short. */
export function rowLengths(count: number): number[] {
  const rows: number[] = [];
  let left = count;
  let want = 2;
  while (left > 0) {
    const n = Math.min(want, left);
    rows.push(n);
    left -= n;
    want = want === 2 ? 3 : 2;
  }
  return rows;
}

export function trailLayout(count: number, containerWidth: number): TrailLayout {
  const available = containerWidth > 0 ? containerWidth : FALLBACK_WIDTH;
  // Three tiles side by side (the widest row) plus two gaps fill the width.
  const hw = Math.max(MIN_HW, Math.min(MAX_HW, Math.floor((available - 2 * HEX_GAP) / 3)));
  const hh = hw * HEX_RATIO;
  const step = hw + HEX_GAP;
  const rowH = hh * 0.75 + HEX_GAP;
  const rowLens = rowLengths(count);
  const rows = rowLens.length;
  const top = hw * 0.55; // room above for prints leaving the honeycomb
  const centres: { x: number; y: number }[] = [];
  rowLens.forEach((n, r) => {
    // A row of 3 starts at the left edge; a row of 2 is shifted half a tile to nestle in.
    const wide = n === 3 || (r % 2 === 1);
    for (let c = 0; c < n; c++) {
      centres.push({ x: hw / 2 + (wide ? c * step : step / 2 + c * step), y: top + (rows - 1 - r) * rowH + hh / 2 });
    }
  });
  const yEnd = top - hw * 0.1;
  const yStart = top + (rows - 1) * rowH + hh + hw * 0.35;
  return {
    hw, hh, compact: hw < COMPACT_BELOW, centres, rowLens,
    width: 2 * step + hw,
    height: yStart + hw * 0.2,
    yStart, yEnd, xMid: hw / 2 + step,
  };
}

/** The centre line of the trail: one smooth meander, always climbing (y strictly decreases). */
export function trailCurve(layout: TrailLayout, points = 240): { x: number; y: number }[] {
  const amp = layout.hw * 0.76;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    out.push({ x: layout.xMid - amp * Math.cos(1.5 * Math.PI * t), y: layout.yStart - (layout.yStart - layout.yEnd) * t });
  }
  return out;
}

export interface Print {
  x: number;
  y: number;
  /** Direction of travel in radians (always pointing up the screen). */
  angle: number;
  left: boolean;
  /** Index of the tile this print is on, or -1 when it is off the honeycomb. */
  tile: number;
  /** Tiles within reach of this print (nearest first). */
  near: number[];
}

/** Walk the curve and drop a print every `spacing` pixels, left then right, with a wide stance. */
export function trailPrints(layout: TrailLayout, curve = trailCurve(layout)): Print[] {
  const spacing = layout.hw * (64 / 170);
  const stance = layout.hw * (21 / 170);
  const prints: Print[] = [];
  let acc = 0;
  let next = spacing / 2;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    while (d > 0 && acc + d >= next) {
      const t = (next - acc) / d;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const left = prints.length % 2 === 1;
      const side = left ? -1 : 1;
      const px = x - Math.sin(angle) * stance * side;
      const py = y + Math.cos(angle) * stance * side;
      const order = layout.centres
        .map((c, idx) => ({ idx, d2: (c.x - px) ** 2 + (c.y - py) ** 2 }))
        .sort((p, q) => p.d2 - q.d2);
      const onTile = order[0] && order[0].d2 <= (layout.hw * 0.62) ** 2 ? order[0].idx : -1;
      const near = order.filter((o) => o.d2 < (layout.hw * 0.8) ** 2).slice(0, 2).map((o) => o.idx);
      prints.push({ x: px, y: py, angle, left, tile: onTile, near });
      next += spacing;
    }
    acc += d;
  }
  return prints;
}

const RANK: Record<Sensitivity, number> = { low: 0, medium: 1, high: 2 };
const NAME: Sensitivity[] = ['low', 'medium', 'high'];

/** Risk of the data under a print: the highest sensitivity of the (up to two) tiles it touches. Off the honeycomb: no data, so black. */
export function printLevel(print: Print, sensitivities: (Sensitivity | undefined)[]): PrintLevel {
  if (print.tile < 0) return 'none';
  let best = -1;
  for (const i of print.near) {
    const s = sensitivities[i];
    if (s && RANK[s] > best) best = RANK[s];
  }
  return best < 0 ? 'low' : NAME[best];
}

/** How many prints land on each tile. */
export function printsPerTile(prints: Print[], tileCount: number): number[] {
  const counts = new Array(tileCount).fill(0);
  for (const p of prints) if (p.tile >= 0) counts[p.tile] += 1;
  return counts;
}

/** 0 = light green (beside the trail), 1 = dark green (the trail stepped here). Two prints are enough for full depth. */
export function greenDepth(printCount: number): number {
  return Math.max(0, Math.min(1, printCount / 2));
}

export const PRINT_COLOURS: Record<PrintLevel, string> = {
  none: '#111111',
  low: '#6b1212',
  medium: '#c9211d',
  high: '#ff4136',
};

function hex(c: string, i: number) { return parseInt(c.slice(i, i + 2), 16); }
/** Blend two #rrggbb colours (t = 0 gives a, t = 1 gives b). */
export function mixColour(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const ch = (i: number) => Math.round(hex(a, i) + (hex(b, i) - hex(a, i)) * k).toString(16).padStart(2, '0');
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}

export const GREEN_LIGHT = '#e6f6ea';
export const GREEN_DARK = '#5cbf7f';
export const GREEN_LIGHT_STROKE = '#9bd3ad';
export const GREEN_DARK_STROKE = '#1e7a40';

/** Whether the trail should step on a tile at all: only tiles we hold data for. */
export function trailTouches(state: TileState): boolean {
  return state === 'held' || state === 'deleting';
}

/** Opacity of a tile (and the prints on it): a deleting tile fades, a gone tile is not drawn. */
export function stateOpacity(state: TileState, deletingOpacity = 0.4): number {
  if (state === 'gone') return 0;
  if (state === 'deleting') return deletingOpacity;
  return 1;
}

/** The two tiles the user always sees (Chris, 2026-11-07): Web, because if they look at the site we have it; Email, because if they sign up we have it. */
export interface Lane {
  id: 'web' | 'email';
  label: string;
  emoji: string;
  state: TileState;
}

export function baseLanes(opts: { webScan: boolean; emailSignedUp: boolean }): Lane[] {
  return [
    { id: 'web', label: 'Web', emoji: '🌐', state: opts.webScan ? 'held' : 'notyet' },
    { id: 'email', label: 'Email', emoji: '✉️', state: opts.emailSignedUp ? 'held' : 'notyet' },
  ];
}

/** Whether a tile list is worth drawing a trail on at all: at least one tile we hold data for. */
export function hasAnyHeld(states: TileState[]): boolean {
  return states.some(trailTouches);
}
