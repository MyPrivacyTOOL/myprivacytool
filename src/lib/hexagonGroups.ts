// One place that decides how hexagons are grouped and ordered, for the dashboard and the exported report.
// The 54 web-scan hexagons use the registry's own groups (the reviewed record), in registry order.
// Findings from other channels (phone: contact, security; email) follow, in the order they first appear.
import type { Hexagon } from '@/types/hexagon';
import { HEXAGON_GROUPS } from '../../shared/hexagon-registry/registry.js';
import { interestRank } from './hexagonInterestOrder';

const CHANNEL_TITLES: Record<string, string> = { contact: 'Contact & Comms', security: 'Security' };
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface HexagonGroup {
  id: string;
  title: string;
  items: Hexagon[];
}

/**
 * CK-7799: the dashboard's display order, most interesting first (src/lib/hexagonInterestOrder.ts, a hypothesis from AI personas,
 * to be re-tested with real people). Same groups and the same members as groupHexagons: inside each group the tiles go by interest
 * rank, and the groups go by their best-ranked tile. Ties keep registry order (Array.sort is stable). The exported report keeps using
 * groupHexagons, so it stays in registry order.
 */
export function groupHexagonsByInterest(hexagons: Hexagon[]): HexagonGroup[] {
  const best = (g: HexagonGroup) => Math.min(...g.items.map((h) => interestRank(h.id)));
  return groupHexagons(hexagons)
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => interestRank(a.id) - interestRank(b.id)) }))
    .sort((a, b) => best(a) - best(b));
}

export function groupHexagons(hexagons: Hexagon[]): HexagonGroup[] {
  const byPillar = new Map<string, Hexagon[]>();
  for (const h of hexagons) byPillar.set(h.pillar, [...(byPillar.get(h.pillar) ?? []), h]);
  const registry: string[] = HEXAGON_GROUPS;
  const order = [...registry.filter((g) => byPillar.has(g)), ...[...byPillar.keys()].filter((p) => !registry.includes(p))];
  return order.map((id) => ({ id, title: registry.includes(id) ? id : CHANNEL_TITLES[id] ?? titleCase(id), items: byPillar.get(id)! }));
}
