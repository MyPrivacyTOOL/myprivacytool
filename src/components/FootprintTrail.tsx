import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  FALLBACK_WIDTH, GREEN_DARK, GREEN_DARK_STROKE, GREEN_LIGHT, GREEN_LIGHT_STROKE, PRINT_COLOURS,
  greenDepth, hasAnyHeld, mixColour, printLevel, printsPerTile, stateOpacity, trailLayout, trailPrints, trailTouches,
  type Print, type Sensitivity, type TileState,
} from '@/lib/footprintTrail';

// The climbing footprint trail on the honeycomb (design: Notion MPC-9546 strategy page, "Design direction, final version"). OFF unless the
// path-trail switch is on (src/config/pathTrail.ts). Drawn as SVG at the real pixel size for the container, so tiles, type and the footprints
// all scale together on a phone, a tablet and a desktop.

export interface TrailTile {
  id: string;
  label: string;
  emoji?: string;
  sensitivity?: Sensitivity;
  state: TileState;
}

const INK = '#14231a';
const MUTE = '#5b6b62';
const GREY = '#8a9a92';

const CAPTION: Record<TileState, string> = {
  held: 'we hold it',
  notyet: 'Not checked yet',
  clear: 'Checked, nothing found',
  cant: "Can't check from here",
  deleting: 'Deleting',
  gone: '',
};

function wrap(label: string, max: number): string[] {
  const words = label.replace('/', ' / ').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= max) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
  }
  return lines.slice(0, 3);
}

function hexPoints(cx: number, cy: number, hw: number, hh: number): string {
  return [[0, -hh / 2], [hw / 2, -hh / 4], [hw / 2, hh / 4], [0, hh / 2], [-hw / 2, hh / 4], [-hw / 2, -hh / 4]]
    .map(([dx, dy]) => `${(cx + dx).toFixed(1)},${(cy + dy).toFixed(1)}`).join(' ');
}

function Foot({ x, y, angle, scale, left, fill, opacity }: { x: number; y: number; angle: number; scale: number; left: boolean; fill: string; opacity: number }) {
  const rot = (angle * 180) / Math.PI + 90;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${left ? -scale : scale} ${scale})`}
      fill={fill} fillOpacity={opacity} stroke="#0b0b0b" strokeWidth={0.34} aria-hidden="true">
      <ellipse cx="0" cy="2.2" rx="2.1" ry="3.1" />
      <circle cx="-2.3" cy="-1.9" r="0.95" /><circle cx="-0.8" cy="-2.9" r="0.95" /><circle cx="0.8" cy="-3" r="0.95" /><circle cx="2.2" cy="-2.3" r="0.95" />
    </g>
  );
}

/** Width of the element, kept up to date. Falls back to a phone-ish width where there is no layout (tests). */
function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [w, setW] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { const r = el.getBoundingClientRect().width; if (r > 0) setW(r); };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface Props {
  tiles: TrailTile[];
  /** Spoken summary of the whole picture. */
  ariaLabel: string;
  /** Draw the footprints. Off for a first visit, when we hold nothing yet. Default true. */
  trail?: boolean;
  className?: string;
}

export default function FootprintTrail({ tiles, ariaLabel, trail = true, className = '' }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const layout = useMemo(() => trailLayout(tiles.length, width), [tiles.length, width]);
  const hatch = useId().replace(/:/g, '');
  const { hw, hh, compact } = layout;
  const fs = hw / 170;

  const showTrail = trail && hasAnyHeld(tiles.map((t) => t.state));
  const prints: Print[] = useMemo(() => (showTrail ? trailPrints(layout) : []), [showTrail, layout]);
  const visible = prints.filter((p) => p.tile < 0 || trailTouches(tiles[p.tile]?.state ?? 'gone'));
  const counts = printsPerTile(visible, tiles.length);
  const sens = tiles.map((t) => t.sensitivity);

  return (
    <div ref={box} className={`w-full ${className}`} data-testid="footprint-trail">
      <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={ariaLabel}
        style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
        <defs>
          <pattern id={`hatch-${hatch}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="9" height="9" fill="#f1f3f2" /><line x1="0" y1="0" x2="0" y2="9" stroke="#cdd5d1" strokeWidth="3" />
          </pattern>
        </defs>

        {tiles.map((t, i) => {
          if (t.state === 'gone') return null;
          const c = layout.centres[i];
          const op = stateOpacity(t.state);
          const depth = greenDepth(counts[i]);
          const held = t.state === 'held' || t.state === 'deleting';
          const fill = held ? mixColour(GREEN_LIGHT, GREEN_DARK, depth)
            : t.state === 'clear' ? GREEN_LIGHT : t.state === 'cant' ? `url(#hatch-${hatch})` : '#ffffff';
          const stroke = held ? mixColour(GREEN_LIGHT_STROKE, GREEN_DARK_STROKE, depth) : t.state === 'clear' ? GREEN_LIGHT_STROKE : GREY;
          return (
            <polygon key={t.id} points={hexPoints(c.x, c.y, hw, hh)} fill={fill} stroke={stroke} strokeWidth={held ? 4.5 : 3.5}
              strokeLinejoin="round" strokeDasharray={t.state === 'cant' ? '3 6' : undefined} opacity={op} />
          );
        })}

        {tiles.map((t, i) => {
          if (t.state !== 'clear') return null;
          const c = layout.centres[i];
          return <Foot key={`clear-${t.id}`} x={c.x + hw * 0.27} y={c.y + hw * 0.08} angle={-Math.PI / 2} scale={4 * fs} left={false} fill={PRINT_COLOURS.none} opacity={0.95} />;
        })}

        {visible.map((p, j) => {
          const level = printLevel(p, sens);
          const op = p.tile >= 0 ? stateOpacity(tiles[p.tile].state) : 1;
          return <Foot key={j} x={p.x} y={p.y} angle={p.angle} scale={5.2 * fs} left={p.left} fill={PRINT_COLOURS[level]} opacity={0.95 * op} />;
        })}

        {tiles.map((t, i) => {
          if (t.state === 'gone') return null;
          const c = layout.centres[i];
          const op = stateOpacity(t.state);
          const lines = wrap(t.label, Math.max(11, Math.floor(14 * fs) + 4));
          const size = Math.max(11, Math.round(16 * fs));
          const line = Math.round(19 * Math.max(fs, 0.62));
          const caption = t.state === 'held' && t.sensitivity ? `we hold it · ${t.sensitivity}` : CAPTION[t.state];
          const spoken = `${t.label}: ${CAPTION[t.state] || t.state}${t.state === 'held' && t.sensitivity ? `, ${t.sensitivity} risk` : ''}`;
          const halo = { stroke: '#ffffff', strokeWidth: 4, paintOrder: 'stroke' } as const;
          return (
            <g key={`label-${t.id}`} opacity={op} role="img" aria-label={spoken}>
              {t.emoji && <text x={c.x} y={c.y - (compact ? 26 : 34)} fontSize={Math.max(18, Math.round(30 * fs))} textAnchor="middle" aria-hidden="true">{t.emoji}</text>}
              {lines.map((l, n) => (
                <text key={n} x={c.x} y={c.y + (compact ? 6 : 16) + n * line} fontSize={size} fontWeight={700} fill={INK} textAnchor="middle" {...halo}>{l}</text>
              ))}
              {!compact && caption && (
                <text x={c.x} y={c.y + hh / 2 - 24} fontSize={12} fontWeight={700} fill={t.state === 'held' ? '#14532d' : MUTE} textAnchor="middle" {...halo}>{caption}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
