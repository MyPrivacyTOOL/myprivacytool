import type { Hexagon, ObservationStatus } from '@/types/hexagon';
import type { TileKind } from '@/lib/hexagonTile';

export interface HexagonVisuals {
  className: string;
  icon: string;
  tooltip: string;
}

export function getHexagonVisuals(status: ObservationStatus): HexagonVisuals {
  switch (status) {
    case 'guess':
      return {
        // Pulsing prompts the user to act; motion-reduce keeps it still for people who ask for that.
        className: 'bg-purple-100 border-purple-500 text-purple-800 animate-pulse motion-reduce:animate-none',
        icon: '?',
        tooltip: 'We think this is you. Tap to confirm.',
      };
    case 'confirmed':
      return { className: 'bg-green-500 border-green-700 text-white', icon: '✓', tooltip: 'Confirmed by you.' };
    case 'false_positive':
      return {
        className: 'bg-gray-200 border-gray-400 text-gray-500 line-through',
        icon: '✕',
        tooltip: 'You said this is not you.',
      };
    case 'disputed':
      return {
        className: 'bg-orange-100 border-orange-500 text-orange-800',
        icon: '!',
        tooltip: 'You disputed this high-confidence finding. Logged for review.',
      };
    case 'checked':
      return { className: 'bg-green-100 border-green-600 text-green-800', icon: '✓', tooltip: 'Checked.' };
    case 'given':
      return { className: 'bg-blue-100 border-blue-500 text-blue-800', icon: '•', tooltip: 'You gave us this.' };
    case 'not_checked':
    default:
      return { className: 'bg-gray-100 border-gray-300 text-gray-500', icon: '–', tooltip: 'Not checked.' };
  }
}

export interface HexPaint {
  /** Tailwind classes for the hexagon outline and fill (SVG polygon). */
  polygon: string;
  /** Text colour inside the hexagon. */
  ink: string;
  dashed: boolean;
}

/** Calm palette on white: green safe or fixed, amber given, purple needs input, grey not checked, red confirmed exposure. */
export function getHexPaint(status: ObservationStatus, exposed = false): HexPaint {
  if (exposed) return { polygon: 'fill-red-50 stroke-red-500', ink: 'text-red-700', dashed: false };
  switch (status) {
    case 'checked':
    case 'confirmed':
      return { polygon: 'fill-green-50 stroke-green-600', ink: 'text-green-700', dashed: false };
    case 'given':
      return { polygon: 'fill-amber-50 stroke-amber-500', ink: 'text-amber-700', dashed: true };
    case 'guess':
      return { polygon: 'fill-purple-50 stroke-purple-500', ink: 'text-purple-700', dashed: false };
    case 'disputed':
      return { polygon: 'fill-orange-50 stroke-orange-500', ink: 'text-orange-700', dashed: false };
    case 'false_positive':
      return { polygon: 'fill-gray-50 stroke-gray-200', ink: 'text-gray-400 line-through', dashed: false };
    case 'not_checked':
    default:
      return { polygon: 'fill-gray-50 stroke-gray-200', ink: 'text-gray-400', dashed: false };
  }
}

/**
 * The honest look for a dashboard tile (colour = what it means, transparency = how we know, grey = no claim): the same kinds the
 * tile grid uses. A finding or a guess never gets the all-clear look, and a fix the visitor says they did is "you told us"
 * (medium green) until we check again. Disputed and rejected tiles keep their own look (undefined).
 */
export function effectiveTile(h: Hexagon, fixed = false): TileKind | undefined {
  if (!h.tile) return undefined;
  if (h.status === 'given') return 'you_told_us';
  if (h.status === 'confirmed') return h.exposure && !fixed ? 'needs_fixing' : 'you_told_us';
  if (h.status === 'guess') return 'our_guess';
  if (h.status === 'checked' || h.status === 'not_checked') return fixed && h.tile === 'needs_fixing' ? 'you_told_us' : h.tile;
  return undefined;
}
