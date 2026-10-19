import type { HexagonData } from '@/lib/deviceDetection';
import { TILE_COPY, type HexagonTile, type TileKind } from '@/lib/hexagonTile';
import type { Hexagon } from '@/types/hexagon';

// Draws a deep-dive finding with the SAME hexagon the home-page scan uses (components/Hexagon.tsx + the tile colours in lib/hexagonTile.ts).
// Colour = what it means, glyph = a symbol so colour is never the only clue, the last line = how we know, in words (never a percentage).
//   checked + exposure   -> red "!" Needs fixing        checked, nothing found -> green tick "Clear"
//   given (Meta's own)   -> grey "i" Seen, low risk     guess                  -> purple "?" Our guess
//   confirmed            -> grey tick "You said yes"    false_positive         -> grey "x" Our guess was wrong
//   disputed             -> grey "x" "You said this is wrong" (value hidden)
//   not_checked          -> grey "Couldn't check" (a provider failed or is not configured; never turned into "clear")
const make = (kind: TileKind, line?: string): HexagonTile => {
  const c = TILE_COPY[kind];
  return { kind, colour: c.colour, level: c.level, glyph: c.glyph, line: line ?? c.line, showValue: c.showValue, browserSays: false };
};

export function findingTile(h: Hexagon): HexagonTile {
  switch (h.status) {
    case 'guess': return make('our_guess');
    case 'checked': return h.exposure ? make('needs_fixing') : make('clear');
    case 'given': return make('seen_low_risk');
    case 'confirmed': return make('you_confirmed');
    case 'false_positive': return make('guess_wrong');
    case 'disputed': return make('guess_wrong', 'You said this is wrong');
    case 'not_checked':
    default: return make('couldnt_check');
  }
}

const ICON: Record<string, string> = { contact: '💬', security: '🛡️', email: '✉️' };

/** The shape Hexagon.tsx expects. `confirmed` stays false: with a tile a tap only means "seen", so nothing is drawn as a tap-confirm. */
export function findingHexagonData(h: Hexagon): HexagonData {
  return {
    id: h.id,
    label: h.label,
    value: h.data ?? '',
    icon: ICON[h.pillar] ?? '•',
    confidence: Math.round((h.confidence_score ?? 0) * 100),
    risk: '',
    confirmed: false,
    category: h.pillar === 'security' ? 'security' : 'social',
  };
}

/** Honeycomb positions: the same arithmetic as HexagonGrid (170px hexagons on desktop, 130px on phones; rows of 3 and 2, or 2 and 2 offset). */
export function honeycomb(count: number, isMobile: boolean) {
  const size = isMobile ? 130 : 170;
  const gap = isMobile ? 8 : 12;
  const hSpacing = size * 0.87 + gap;
  const vSpacing = size * 0.75 + gap;
  const topPadding = 10;
  const positions: { x: number; y: number }[] = [];
  let index = 0;
  for (let row = 0; index < count; row++) {
    const even = row % 2 === 0;
    const inRow = isMobile ? 2 : even ? 3 : 2;
    for (let col = 0; col < inRow && index < count; col++) {
      const x = isMobile ? (even ? 0 : hSpacing * 0.5) + hSpacing * col : even ? hSpacing * col : hSpacing * (0.5 + col);
      positions.push({ x, y: topPadding + vSpacing * row });
      index++;
    }
  }
  const maxY = positions.length ? Math.max(...positions.map((p) => p.y)) : 0;
  return { positions, width: isMobile ? hSpacing * 1.5 + size : hSpacing * 2 + size, height: maxY + size };
}
