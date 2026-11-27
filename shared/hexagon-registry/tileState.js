// MPC-11541: the one rule for the Live / In build / Planned badge on every /footprint/ tile. Same three words and meanings as the feature-state config
// (src/config/featureStatus.ts, MPC-9836) and the Footprint Path tiles (src/config/footprintPathTiles.ts): Live = running today; In build = built but off; Planned = documented only.
//   live      a check that runs today: one of the 54 checks of the web scan (registry.js HEXAGONS), or one of the email checks that are built and run in the report
//             (EMAIL_SCORED_IDS, MPC-11569: the 6 with build_status "built"). Nothing else is ever Live: a check that does not run is never marked Live,
//             and an email hexagon that is not built (email-breaches: "not built: terms unconfirmed") stays In build.
//   in_build  built in the code but not a running check: the built extras (EXTRA_HEXAGON_IDS in channels.js, off until their switch is on) and the catalogue items already
//             defined in the code that are not Live (the unbuilt email check, Telegram 30, X candidates).
//   planned   everything else: found in the platform documentation, not built, not checked.
// Changing a state means changing the code (the 54, the email build_status, EXTRA_HEXAGON_IDS) or the catalogue `status`; this file has no list of its own.
import { HEXAGONS } from './registry.js';
import { EXTRA_HEXAGON_IDS } from './channels.js';
import { EMAIL_SCORED_IDS } from './scoreV2.js';

export const TILE_LABEL = { live: 'Live', in_build: 'In build', planned: 'Planned' };

const LIVE = new Set([...HEXAGONS.map((h) => h.id), ...EMAIL_SCORED_IDS]);
const EXTRA = new Set(EXTRA_HEXAGON_IDS);

/** @param {{ id: string, status?: string }} item a catalogue item */
export function tileState(item) {
  if (LIVE.has(item.id)) return 'live';
  if (EXTRA.has(item.id) || item.status === 'defined') return 'in_build';
  return 'planned';
}
