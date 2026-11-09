// The Email lane, breach and threat monitoring, WhatsApp and Facebook Messenger laid out for the climbing footprint trail (Chris, 2026-11-08: "these are the
// most important"). Tiles come from the catalogue (shared/hexagon-registry/catalogue.js), the system of record for what is live, planned,
// later or not planned. Each caption says the truth about the tile; a preview must never make a tile look closer than it is.
import type { Sensitivity, TileState } from '@/lib/footprintTrail';
import { HEXAGON_CATALOGUE, type CatalogueHexagon } from '../../shared/hexagon-registry/catalogue.js';

export interface ChannelGroup {
  key: string;
  title: string;
  rows: number[];
  story: string;
}

export const CHANNEL_GROUPS: ChannelGroup[] = [
  { key: 'email', title: 'Email', rows: [2, 3, 2, 3, 2, 3, 2, 3, 1], story: 'How they reach us, then what the address and domain reveal, then attachments, then public traces.' },
  { key: 'breach-threat', title: 'Breach and threat monitoring', rows: [2, 3, 1], story: 'What leaked and since when, then where it circulates. Needs a licensed data provider, so nothing runs yet.' },
  { key: 'whatsapp', title: 'WhatsApp', rows: [2, 3, 2, 3, 2, 3, 2, 3, 2], story: 'Chris, 2026-11-08: eight tiles are planned (what arrives with a message, or what the person shares). The other 14 stay not planned.' },
  { key: 'messenger', title: 'Facebook Messenger', rows: [3, 2, 3], story: 'Owner decision: not planned today (needs Meta platform partner approval).' },
];

export interface ChannelTile {
  id: string;
  label: string;
  emoji?: string;
  sensitivity?: Sensitivity;
  /** The state today (what is true now). */
  today: TileState;
  /** Truthful caption for the state today. */
  caption?: string;
}

/** Breach and threat monitoring tiles (named by Chris, 2026-11-08) are not in the catalogue yet (new hexagons stay outside it until approved), so they are listed here. */
const BREACH_THREAT: ChannelTile[] = [
  { id: 'dw-first-seen', label: 'First seen', emoji: '📅', sensitivity: 'medium', today: 'notyet', caption: 'Coming soon' },
  { id: 'dw-what-leaked', label: 'What leaked', emoji: '🗂️', sensitivity: 'high', today: 'notyet', caption: 'Coming soon' },
  { id: 'dw-password', label: 'Password exposure', emoji: '🔑', sensitivity: 'high', today: 'notyet', caption: 'Free check, you start it' },
  { id: 'dw-stealer-logs', label: 'Stealer logs', emoji: '🧛', sensitivity: 'high', today: 'notyet', caption: 'Coming soon' },
  { id: 'dw-paste-sites', label: 'Paste sites', emoji: '📋', sensitivity: 'medium', today: 'notyet', caption: 'Coming soon' },
  { id: 'dw-marketplaces', label: 'Marketplaces', emoji: '🛒', sensitivity: 'high', today: 'notyet', caption: 'Coming soon' },
];

/** What is true for one catalogue tile today. Live tiles are held (in the example), everything else is not checked, and says why. */
export function todayFor(h: Pick<CatalogueHexagon, 'status' | 'plan'>): { state: TileState; caption?: string } {
  if (h.plan === 'not_planned') return { state: 'notyet', caption: 'Not planned today' };
  if (h.plan === 'later') return { state: 'notyet', caption: 'Later' };
  if (h.status === 'defined') return { state: 'held' };
  return { state: 'notyet', caption: 'Planned' };
}

export function channelTiles(key: string): ChannelTile[] {
  if (key === 'breach-threat') return BREACH_THREAT;
  return (HEXAGON_CATALOGUE as CatalogueHexagon[])
    .filter((h) => h.channel === key)
    .map((h) => {
      const t = todayFor(h);
      return { id: h.id, label: h.label, sensitivity: h.risk, today: t.state, caption: t.caption };
    });
}
