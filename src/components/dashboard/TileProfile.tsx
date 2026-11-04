import { riskProfile, riskProfileParts } from '@/lib/hexagonTile';
import type { TileKind } from '@/lib/hexagonTile';

interface Props {
  /** The look of every tile that has one (effectiveTile), so the counts are exactly what the visitor sees. */
  kinds: TileKind[];
}

const LEGEND: { label: string; style: React.CSSProperties }[] = [
  { label: 'Clear: we checked', style: { background: 'hsl(var(--tile-green))' } },
  { label: 'You told us', style: { background: 'hsl(var(--tile-green) / 0.42)' } },
  { label: 'Needs fixing', style: { background: 'hsl(var(--tile-red))' } },
  { label: 'Our guess', style: { background: 'hsl(var(--tile-purple) / 0.16)', border: '1px solid hsl(var(--tile-purple))' } },
  { label: 'Grey: no claim (i = seen, minor)', style: { border: '2px solid hsl(var(--tile-grey))' } },
];

/** The risk profile as plain counts (never a score or a percentage) and a key to the tiles, under the dashboard heading. */
export const TileProfile = ({ kinds }: Props) => {
  if (kinds.length === 0) return null;
  const parts = riskProfileParts(riskProfile(kinds.map((kind) => ({ kind }))));
  return (
    <div className="space-y-2" data-testid="tile-profile">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Your risk profile</p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm text-gray-900" aria-live="polite" aria-atomic="true">
          {parts.map((p, i) => (
            <span key={p.key} data-testid={`tile-profile-${p.key}`}>
              {i > 0 && <span aria-hidden="true" className="mr-3 text-gray-400">·</span>}
              {p.text}
            </span>
          ))}
        </p>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="What the tile looks mean">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-sm" style={l.style} />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
};
