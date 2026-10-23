// MPC-8452: switch for the live thank-you on /scan (Alice, curtain reveal, hexagons filling in from the visitor's own scan).
// OFF by default. Turn it on for a build with VITE_LIVE_THANKYOU="true" (also "1", "on", "yes"), or look at it in one browser
// tab with ?live_ty=1 (never stored, does nothing to other visitors). Read at call time so tests can change it.

export function parseLiveThankYou(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function liveThankYouEnabled(search?: string): boolean {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    if (/[?&]live_ty=1(&|$)/.test(q)) return true;
  } catch {
    /* no window or blocked: use the build setting */
  }
  return parseLiveThankYou(import.meta.env.VITE_LIVE_THANKYOU);
}
