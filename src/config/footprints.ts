// The footprints cue (the Path, Chris 2026-10-23): a trail behind you of the hexagons you have stepped on, the promise that removing a step
// removes its footprint, and a remove button on each. OFF by default. Turn it on for a build with VITE_FOOTPRINTS_CUE="true" (also "1", "on",
// "yes"), or look at it in any browser tab with ?footprints=1 (never stored, does nothing to other visitors). Read at call time so tests can change it.

export function parseFootprintsCue(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function footprintsCueEnabled(search?: string): boolean {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    if (/[?&]footprints=1(&|$)/.test(q)) return true;
  } catch {
    /* no window or blocked: use the build setting */
  }
  return parseFootprintsCue(import.meta.env.VITE_FOOTPRINTS_CUE);
}
