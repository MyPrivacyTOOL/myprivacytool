import { useEffect, useRef, useState } from 'react';
import type { Hexagon, ScanResult } from '@/types/hexagon';
import { InteractiveHexagonTile } from '@/components/InteractiveHexagonTile';
import { tileShowsValue } from '@/utils/hexagonStyles';
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

interface HiveReport { phone: boolean; withValue: number }

const Hive = ({ items, fixedIds, onConfirm, onDispute, onKeep, onSelect, variantId, onReport }: Omit<Props, 'scanResult'> & { items: Hexagon[]; variantId: string; onReport: (r: HiveReport) => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const layout = hiveLayout(items.length, width, { readable: variantId === 'readable_tiles' });
  // Phones only (the layouts below four columns): that is who the experiment is about. Nothing is reported until the width is measured.
  const phone = width > 0 && layout.cols < 4;
  const withValue = items.filter((h) => tileShowsValue(h, !!fixedIds?.has(h.id), layout.compact)).length;
  useEffect(() => {
    if (width > 0) onReport({ phone, withValue });
  }, [width, phone, withValue, onReport]);
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
export const HexagonGrid = ({ scanResult, ...handlers }: Props) => {
  const { variantId, forced, active } = useExperiment('mobile_hive');
  const groups = groupHexagonsByInterest(scanResult.hexagons);
  // mobile_hive measurement: ONE exposure and ONE hex_value_rendered per grid, sent once every pillar has been measured (not per pillar,
  // or a visitor would count once for each pillar). Counts only: how many tiles show a value line. No values, no scan data.
  const [reports, setReports] = useState<Record<number, HiveReport>>({});
  const sent = useRef(false);
  useEffect(() => {
    const all = Object.values(reports);
    // Only while the experiment is live (or a forced QA view, which sends nothing): with the flag off, GA4 hears nothing new.
    if (!active && !forced) return;
    if (sent.current || groups.length === 0 || all.length < groups.length) return;
    sent.current = true;
    if (!all.some((r) => r.phone)) return; // not a phone-width grid: the experiment is not about this visitor
    trackExperimentExposure('mobile_hive', variantId, forced);
    if (!forced) trackEvent('hex_value_rendered', { experiment_id: 'mobile_hive', variant_id: variantId, hexes_with_value: all.reduce((n, r) => n + r.withValue, 0) });
  }, [reports, groups.length, variantId, forced, active]);
  const reporters = useRef<Record<number, (r: HiveReport) => void>>({});
  const reporter = (i: number) =>
    (reporters.current[i] ??= (r) => setReports((prev) => (prev[i]?.phone === r.phone && prev[i]?.withValue === r.withValue ? prev : { ...prev, [i]: r })));
  return (
    <div className="grid gap-x-6 gap-y-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr))]">
      {groups.map((group, i) => (
        <section key={group.id} aria-labelledby={`pillar-${group.id.replace(/\W+/g, '-')}`}>
          <h2 id={`pillar-${group.id.replace(/\W+/g, '-')}`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {group.title}
          </h2>
          <Hive items={group.items} {...handlers} variantId={variantId} onReport={reporter(i)} />
        </section>
      ))}
    </div>
  );
};
