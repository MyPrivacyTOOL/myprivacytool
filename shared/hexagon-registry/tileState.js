// MPC-11541: the one rule for the Live / In build / Planned badge on every /footprint/ tile. Same three words and meanings as the feature-state config
// (src/config/featureStatus.ts, MPC-9836) and the Footprint Path tiles (src/config/footprintPathTiles.ts): Live = running today; In build = built but off; Planned = documented only.
//   live      the item is one of the 54 checks of the web scan (registry.js HEXAGONS), or (MPC-11569) one of the email checks that genuinely run at first contact and have
//             returned real data in production (LIVE_EMAIL_IDS_V2 in score-v2.js; 6 of the 7, never `email-breaches`). Nothing else is ever Live: a check the scan does not run is never marked Live.
//   in_build  built in the code but outside the 54: the built extras (EXTRA_HEXAGON_IDS in channels.js, off until their switch is on) and the catalogue items already defined
//             in the code (email 7, Telegram 30, X candidates), which are not part of the 54-check web scan.
//   planned   everything else: found in the platform documentation, not built, not checked.
// Changing a state means changing the code (the 54, EXTRA_HEXAGON_IDS) or the catalogue `status`; this file has no list of its own.
import { HEXAGONS } from './registry.js';
import { EXTRA_HEXAGON_IDS } from './channels.js';
import { LIVE_EMAIL_IDS_V2 } from './score-v2.js';

export const TILE_LABEL = { live: 'Live', in_build: 'In build', planned: 'Planned' };

const LIVE = new Set([...HEXAGONS.map((h) => h.id), ...LIVE_EMAIL_IDS_V2]);
const EXTRA = new Set(EXTRA_HEXAGON_IDS);

/** @param {{ id: string, status?: string }} item a catalogue item */
export function tileState(item) {
  if (LIVE.has(item.id)) return 'live';
  if (EXTRA.has(item.id) || item.status === 'defined') return 'in_build';
  return 'planned';
}
