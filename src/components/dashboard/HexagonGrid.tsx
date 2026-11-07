import { useEffect, useRef } from 'react';
import type { Hexagon, ScanResult } from '@/types/hexagon';
import { InteractiveHexagonTile } from '@/components/InteractiveHexagonTile';
import { useElementWidth } from '@/hooks/useElementWidth';
import { HEX_RATIO, hiveLayout } from '@/lib/honeycomb';
import { groupHexagonsByInterest } from '@/lib/hexagonGroups';
import { useExperiment } from '@/hooks/useExperiment';
import { trackEvent, trackExperimentExposure } from '@/lib/analytics';

interface Props {
  scanResult: ScanResult;
  onConfirm: (id: string, isMatch: boolean) => void;
  onDispute: (id: string) => void;
  onKeep?: (id: string) => void;
  onSelect: (hexagon: Hexagon) => void;
  /** Ids of confirmed exposures the user has fixed. */
  fixedIds?: ReadonlySet<string>;
}

const Hive = ({ items, fixedIds, onConfirm, onDispute, onKeep, onSelect }: Omit<Props, 'scanResult'> & { items: Hexagon[] }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { variantId, forced } = useExperiment('mobile_hive');
  const width = useElementWidth(ref);
  const layout = hiveLayout(items.length, width, { readable: variantId === 'readable_tiles' });
  // Phones only (the layouts below four columns): that is who the experiment is about. Once per mount and layout, not per render.
  const phone = width > 0 && layout.cols < 4;
  useEffect(() => {
    if (!phone) return;
    trackExperimentExposure('mobile_hive', variantId, forced);
    // Counts only: how many tiles were drawn and whether their value line was. No values, no scan data.
    if (!forced) trackEvent('hive_values_rendered', { experiment_id: 'mobile_hive', variant_id: variantId, tiles: items.length, values_shown: !layout.compact });
  }, [phone, variantId, forced, items.length, layout.compact]);
  return (
    <div ref={ref} className="w-full">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        {items.map((h, i) => (
          <InteractiveHexagonTile
            key={h.id}
            hexagon={h}
            onConfirm={onConfirm}
            onDispute={onDispute}
            onKeep={onKeep}
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
    {groupHexagonsByInterest(scanResult.hexagons).map((group) => (
      <section key={group.id} aria-labelledby={`pillar-${group.id.replace(/\W+/g, '-')}`}>
        <h2 id={`pillar-${group.id.replace(/\W+/g, '-')}`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          {group.title}
        </h2>
        <Hive items={group.items} {...handlers} />
      </section>
    ))}
  </div>
);
