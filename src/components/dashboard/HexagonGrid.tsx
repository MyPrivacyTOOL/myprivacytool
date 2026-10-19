import { useRef } from 'react';
import type { Hexagon, ScanResult } from '@/types/hexagon';
import { InteractiveHexagonTile } from '@/components/InteractiveHexagonTile';
import { useElementWidth } from '@/hooks/useElementWidth';
import { HEX_RATIO, hiveLayout } from '@/lib/honeycomb';
import { groupHexagons } from '@/lib/hexagonGroups';

interface Props {
  scanResult: ScanResult;
  onConfirm: (id: string, isMatch: boolean) => void;
  onDispute: (id: string) => void;
  onSelect: (hexagon: Hexagon) => void;
  /** Ids of confirmed exposures the user has fixed. */
  fixedIds?: ReadonlySet<string>;
}

const Hive = ({ items, fixedIds, onConfirm, onDispute, onSelect }: Omit<Props, 'scanResult'> & { items: Hexagon[] }) => {
  const ref = useRef<HTMLDivElement>(null);
  const layout = hiveLayout(items.length, useElementWidth(ref));
  return (
    <div ref={ref} className="w-full">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        {items.map((h, i) => (
          <InteractiveHexagonTile
            key={h.id}
            hexagon={h}
            onConfirm={onConfirm}
            onDispute={onDispute}
            onSelect={onSelect}
            fixed={fixedIds?.has(h.id)}
            compact={layout.compact}
            className="absolute"
            style={{ left: layout.positions[i].left, top: layout.positions[i].top, width: layout.hw, height: layout.hw * HEX_RATIO }}
          />
        ))}
      </div>
    </div>
  );
};

/** One column on a phone or iPad held upright, two pillars side by side once there is room (desktop, landscape). */
export const HexagonGrid = ({ scanResult, ...handlers }: Props) => (
  <div className="grid gap-x-6 gap-y-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr))]">
    {groupHexagons(scanResult.hexagons).map((group) => (
      <section key={group.id} aria-labelledby={`pillar-${group.id.replace(/\W+/g, '-')}`}>
        <h2 id={`pillar-${group.id.replace(/\W+/g, '-')}`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          {group.title}
        </h2>
        <Hive items={group.items} {...handlers} />
      </section>
    ))}
  </div>
);
