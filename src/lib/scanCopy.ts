import { hexTileV2Enabled } from '@/config/hexagonTile';
import { tileExplanation, type HexagonTile } from '@/lib/hexagonTile';

// CK-7805: owner-approved wording (2026-10-14). One place so the hint and the voice panel stay in step.
export const HINT_TOUCH = 'Tap a hexagon to see what we found. Tapping also confirms it looks right to you.';
export const HINT_POINTER = 'Hover or click a hexagon to see what we found. Clicking confirms it looks right to you.';

// MPC-7916: with the honest tiles on, a tap only means "I have looked at this". It confirms nothing.
export const HINT_TOUCH_V2 = 'Tap a hexagon to see what we found. A tap does not confirm anything.';
export const HINT_POINTER_V2 = 'Hover or click a hexagon to see what we found. A click does not confirm anything.';

// MPC-7916: Alice (VoiceAI, spoken) with the honest tiles on. She says what the tile says: no "I found N data points without asking", no
// "click to confirm", no percentage, no tap-driven progress talk, and for a tile that makes no claim only that it makes no claim.
export const ALICE_TILES_INTRO = "Hi, I'm Alice. I look at what your browser tells every website, and I say how we know each thing. Hover or tap a hexagon to see what I found.";
export const ALICE_TILES_NEXT = "Tap another hexagon to see what I found. A grey hexagon is one I make no claim about, and I won't guess at it.";
export function aliceTileMessage(
  hex: { label: string; value: string; displayValue?: string; explanation?: string; risk?: string } | null,
  tile: HexagonTile | undefined,
  seenCount: number
): string {
  if (hex && tile) {
    const said = tileExplanation(hex.label, hex.displayValue ?? hex.value, tile, undefined, hex.explanation ?? hex.risk);
    // A tile that shows its value also says how we know it (the tile's own bottom line); a grey tile says only why it makes no claim.
    return (tile.showValue ? `${said.headline}. ${tile.line}. ${said.text}` : `${said.headline}. ${said.text}`).trim();
  }
  return seenCount === 0 ? ALICE_TILES_INTRO : ALICE_TILES_NEXT;
}

export const DNS_BANNER = 'Heads-up: your website lookups may be bypassing your VPN. Worth a closer look.';

/** Phones and tablets have no hover, so they get the tap wording. Falls back to the pointer wording where matchMedia is missing. */
export function scanHint(): string {
  const v2 = hexTileV2Enabled();
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches) return v2 ? HINT_TOUCH_V2 : HINT_TOUCH;
  } catch {
    /* use the pointer wording */
  }
  return v2 ? HINT_POINTER_V2 : HINT_POINTER;
}

// Hero copy (home page) with tiles on: no "found N data points without asking", no "click the ones that are correct".
export const HERO_TILES_LINE1 = 'See what your browser tells every website, and how we know each thing.';
export const HERO_TILES_LINE2 = 'Tap a hexagon to see what we found.';
export const SUMMARY_LABELS = { clear: 'clear', fixing: 'need fixing', notYet: 'not checked yet' } as const;
