import { hexagonTilesEnabled } from '@/lib/hexagonTile';

// CK-7805: owner-approved wording (2026-10-14). One place so the hint and the voice panel stay in step.
export const HINT_TOUCH = 'Tap a hexagon to see what we found. Tapping also confirms it looks right to you.';
export const HINT_POINTER = 'Hover or click a hexagon to see what we found. Clicking confirms it looks right to you.';

export const DNS_BANNER = 'Heads-up: your website lookups may be bypassing your VPN. Worth a closer look.';

// Hexagon tiles (VITE_HEXAGON_TILES): a tap means "I've seen this", not "this is right", so the hint no longer promises a confirmation.
// English only, draft wording for Chris to review.
export const HINT_TOUCH_SEEN = 'Tap a hexagon to see what we found and how sure we are.';
export const HINT_POINTER_SEEN = 'Hover or click a hexagon to see what we found and how sure we are.';

/** Phones and tablets have no hover, so they get the tap wording. Falls back to the pointer wording where matchMedia is missing. */
export function scanHint(): string {
  const seen = hexagonTilesEnabled();
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches) return seen ? HINT_TOUCH_SEEN : HINT_TOUCH;
  } catch {
    /* use the pointer wording */
  }
  return seen ? HINT_POINTER_SEEN : HINT_POINTER;
}

// Tile copy (VITE_HEXAGON_TILES). Unknown tiles never show a value, a number or any "clean" wording.
export const TILE_CLASS_LABEL = {
  verified: 'We checked',
  self_attested: 'You told us',
  inferred: 'Looks like',
  unknown: 'Not known',
} as const;
export const TILE_ESTIMATE_LABEL = 'our estimate';
export const TILE_UNKNOWN_SHORT = {
  cannot_check_from_web: "Can't see this from a web page",
  check_unavailable: 'Check unavailable',
  not_yet_checked: 'Not checked yet',
  stale: 'Needs a re-check',
} as const;
export const TILE_UNKNOWN_LONG = {
  cannot_check_from_web: "We can't check this from a web page. A real check needs something you start.",
  check_unavailable: 'The check did not complete. Try again.',
  not_yet_checked: 'We have not checked this yet.',
  stale: 'This is out of date and needs a re-check.',
} as const;
export const SUMMARY_LABELS = { verified: 'verified', fixes: 'fixes you told us about', notYet: 'not yet checked' } as const;
