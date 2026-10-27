// CK-8494: switch for the WebRTC action and re-check journey. OFF by default and BUILD-ONLY: unlike ?hex_v2=2 there is deliberately no URL
// parameter, so nobody can turn it on for themselves on production. Turn it on for a build with VITE_RECHECK_JOURNEY="true" (also "1", "on", "yes"),
// only after the copy review, the real-people check and CK-8492's consent and event evidence.
import { parseHexTileV2 } from '@/config/hexagonTile';

export const recheckJourneyEnabled = (raw: unknown = import.meta.env.VITE_RECHECK_JOURNEY): boolean => parseHexTileV2(raw);
