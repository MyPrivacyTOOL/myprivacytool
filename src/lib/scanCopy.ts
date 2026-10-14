// CK-7805: owner-approved wording (2026-10-14). One place so the hint and the voice panel stay in step.
export const HINT_TOUCH = 'Tap a hexagon to see what we found. Tapping also confirms it looks right to you.';
export const HINT_POINTER = 'Hover or click a hexagon to see what we found. Clicking confirms it looks right to you.';

export const DNS_BANNER = 'Heads-up: your website lookups may be bypassing your VPN. Worth a closer look.';

/** Phones and tablets have no hover, so they get the tap wording. Falls back to the pointer wording where matchMedia is missing. */
export function scanHint(): string {
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches) return HINT_TOUCH;
  } catch {
    /* use the pointer wording */
  }
  return HINT_POINTER;
}
