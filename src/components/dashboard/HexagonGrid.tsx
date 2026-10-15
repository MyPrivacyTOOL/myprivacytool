import type { Hexagon, ScanResult } from '@/types/hexagon';
import { InteractiveHexagonTile } from '@/components/InteractiveHexagonTile';

interface Props {
  scanResult: ScanResult;
  onConfirm: (id: string, isMatch: boolean) => void;
  onDispute: (id: string) => void;
  onSelect: (hexagon: Hexagon) => void;
  /** Ids of confirmed exposures the user has fixed. */
  fixedIds?: ReadonlySet<string>;
}

const PILLARS: { id: string; title: string }[] = [
  { id: 'identity', title: 'Core Identity' },
  { id: 'contact', title: 'Contact & Comms' },
  { id: 'social', title: 'Social' },
  { id: 'web', title: 'Web' },
  { id: 'security', title: 'Security' },
  { id: 'device', title: 'Device' },
];

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Known pillars first in the designed order; any other pillar id follows so no hexagon is ever dropped. */
const groupByPillar = (hexagons: Hexagon[]) => {
  const groups = new Map<string, Hexagon[]>();
  for (const h of hexagons) groups.set(h.pillar, [...(groups.get(h.pillar) ?? []), h]);
  const known = PILLARS.filter((p) => groups.has(p.id)).map((p) => ({ ...p, items: groups.get(p.id)! }));
  const extra = [...groups.keys()]
    .filter((id) => !PILLARS.some((p) => p.id === id))
    .map((id) => ({ id, title: titleCase(id), items: groups.get(id)! }));
  return [...known, ...extra];
};

export const HexagonGrid = ({ scanResult, onConfirm, onDispute, onSelect, fixedIds }: Props) => (
  <div className="space-y-8">
    {groupByPillar(scanResult.hexagons).map((group) => (
      <section key={group.id} aria-labelledby={`pillar-${group.id}`}>
        <h2 id={`pillar-${group.id}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">
          {group.title}
        </h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9">
          {group.items.map((h) => (
            <InteractiveHexagonTile
              key={h.id}
              hexagon={h}
              onConfirm={onConfirm}
              onDispute={onDispute}
              onSelect={onSelect}
              fixed={fixedIds?.has(h.id)}
              className="aspect-square h-auto w-full"
            />
          ))}
        </div>
      </section>
    ))}
  </div>
);
