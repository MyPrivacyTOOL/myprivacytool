// The climbing footprint trail on the honeycomb (Chris, 2026-11-07; design in Notion, MPC-9546). OFF by default.
// Turn it on for a build with VITE_PATH_TRAIL="true" (also "1", "on", "yes"), or look at it in any browser tab with ?path=1
// (never stored, does nothing to other visitors). Read at call time so tests can change it. Same pattern as src/config/footprints.ts.

export function parsePathTrail(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function pathTrailEnabled(search?: string): boolean {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    if (/[?&]path=1(&|$)/.test(q)) return true;
  } catch {
    /* no window or blocked: use the build setting */
  }
  return parsePathTrail(import.meta.env.VITE_PATH_TRAIL);
}
