// MPC-7916 Phase 1: switch for the honest hexagon tiles (colour, transparency and wording say how we know).
// OFF by default. Turn it on for a build with VITE_HEX_TILE_V2="true" (also "1", "on", "yes"), or look at it in any browser
// tab with ?hex_v2=1 (never stored, does nothing to other visitors). Read at call time so tests can change it.

export function parseHexTileV2(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function hexTileV2Enabled(search?: string): boolean {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    if (/[?&]hex_v2=1(&|$)/.test(q)) return true;
  } catch {
    /* no window or blocked: use the build setting */
  }
  // VITE_HEXAGON_TILES is the older name for the same switch (it was on main before this one); either turns the tiles on.
  return parseHexTileV2(import.meta.env.VITE_HEX_TILE_V2) || parseHexTileV2(import.meta.env.VITE_HEXAGON_TILES);
}
