import { useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';
import { bandFor, type HexagonTile } from '@/lib/hexagonTile';
import { TILE_CLASS_LABEL, TILE_ESTIMATE_LABEL, TILE_UNKNOWN_SHORT } from '@/lib/scanCopy';

interface HexagonProps {
  data: HexagonData;
  onConfirm: (id: string) => void;
  onHover: (data: HexagonData | null) => void;
  isRevealing?: boolean;
  /** CK-7805: called on every tap or click so the explanation stays on screen (touch has no hover). */
  onSelect?: (data: HexagonData) => void;
  /** Tile state (VITE_HEXAGON_TILES). When set, the tile is drawn by class and never shows a bare percentage. */
  tile?: HexagonTile;
}

// Single palette treatment: deep green outline on a soft green tint (see index.css brand tokens).
const hexColors = {
  primary: 'hsl(var(--brand-ink))',
  glow: 'hsl(var(--brand-ink) / 0.45)',
  bg: ['hsl(var(--surface) / var(--surface-alpha))', 'hsl(var(--brand-soft) / var(--surface-alpha))'] as [string, string],
};

export default function Hexagon({ data, onConfirm, onHover, isRevealing = false, onSelect, tile }: HexagonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (!isRevealing && data.id !== 'revealing') onSelect?.(data);
    if (!data.confirmed && !isRevealing && data.id !== 'revealing') {
      onConfirm(data.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (!isRevealing && data.id !== 'revealing') {
      onHover(data);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    onHover(null);
  };

  const colors = hexColors;

  // Pointy-top hexagon path (vertices at top and bottom)
  const hexPath = "M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z";

  // Determine stroke color based on state
  const getStrokeColor = () => {
    if (isRevealing) return 'hsl(var(--brand-ink))';
    if (data.confirmed) return colors.primary;
    if (isHovered) return colors.glow;
    return colors.primary;
  };

  // Determine label color based on category
  const getLabelColor = () => {
    if (data.confirmed) return colors.primary;
    return colors.primary;
  };

  // Tile mode: Unknown tiles say why they are unknown and carry no value or number; Verified/Inferred say how sure we are in words.
  const unknownShort = tile?.class === 'unknown' ? TILE_UNKNOWN_SHORT[tile.unknown_reason ?? 'check_unavailable'] : null;
  const band = tile && tile.class !== 'unknown' ? bandFor(data.confidence) : null;
  const classLabel = tile ? TILE_CLASS_LABEL[tile.class] : null;
  const ariaLabel = tile
    ? tile.class === 'unknown'
      ? `${data.label}: ${classLabel}. ${unknownShort}. ${data.confirmed ? 'Seen' : 'Tap to see details'}`
      : `${data.label}: ${data.displayValue ?? data.value}. ${classLabel}${tile.is_estimate ? `, ${TILE_ESTIMATE_LABEL}` : ''}, ${band?.word}. ${data.confirmed ? 'Seen' : 'Tap to see details'}`
    : `${data.label}: ${data.displayValue ?? data.value}. Confidence: ${data.confidence}%. ${data.confirmed ? 'Confirmed' : 'Tap to confirm'}`;
  const cls = tile?.class;
  const tileGlyph = cls === 'verified' ? '✓' : cls === 'inferred' ? '~' : cls === 'self_attested' ? '•' : cls === 'unknown' ? '?' : null;

  return (
    <div className={cn(
      "animate-fade-in hexagon-wrapper",
      cls && `hexagon-tile hexagon-tile-${cls}`,
      data.confirmed && "confirmed",
      isHovered && "hovered",
      isRevealing && "hexagon revealing revealing-wrapper"
    )}>
      <div className={cn(
        "hexagon-inner relative",
        isRevealing && "hexagon-content"
      )}>
        <svg
          viewBox="0 0 100 100"
          className={cn(
            "w-[110px] h-[110px] sm:w-[150px] sm:h-[150px] md:w-[170px] md:h-[170px] transition-transform duration-300",
            !isRevealing && "cursor-pointer hover:scale-105 active:scale-95",
            "outline-none focus-visible:drop-shadow-[0_0_6px_#00ff41]",
            data.confirmed && !isRevealing && "animate-hexagon-confirm"
          )}
          role={isRevealing ? undefined : 'button'}
          tabIndex={isRevealing ? -1 : 0}
          aria-pressed={isRevealing ? undefined : !!data.confirmed}
          onKeyDown={handleKeyDown}
          onFocus={() => !isRevealing && onHover(data)}
          onBlur={() => onHover(null)}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onTouchStart={() => setIsHovered(true)}
          onTouchEnd={() => { setIsHovered(false); onHover(null); }}
          aria-label={ariaLabel}
        >
          <defs>
            <pattern id={`hatch-${data.id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'hsl(var(--brand-ink) / 0.35)' }} strokeWidth="1.5" />
            </pattern>
            <filter id={`glow-${data.id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            {/* Category-based gradient */}
            <linearGradient id={`hexGradient-${data.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
              {isRevealing ? (
                <>
                  <stop offset="0%" style={{ stopColor: 'hsl(var(--brand-soft))' }} />
                  <stop offset="100%" style={{ stopColor: 'hsl(var(--surface))' }} />
                </>
              ) : (
                <>
                  <stop offset="0%" style={{ stopColor: colors.bg[0] }} />
                  <stop offset="100%" style={{ stopColor: colors.bg[1] }} />
                </>
              )}
            </linearGradient>
          </defs>

          {/* Background hexagon fill. Unknown tiles are empty; Inferred tiles are hatched. */}
          {cls !== 'unknown' && (
            <path
              d={hexPath}
              fill={`url(#hexGradient-${data.id})`}
            />
          )}
          {cls === 'inferred' && <path d={hexPath} fill={`url(#hatch-${data.id})`} />}

          {/* Border with category-based coloring */}
          <path
            d={hexPath}
            fill="none"
            strokeWidth={isRevealing ? "3" : data.confirmed ? "3" : isHovered ? "2.5" : "2"}
            strokeDasharray={cls === 'unknown' ? '3 3' : cls === 'self_attested' ? '1 4' : undefined}
            strokeLinecap={cls === 'self_attested' ? 'round' : undefined}
            opacity={isRevealing ? 1 : data.confirmed ? 1 : isHovered ? 0.85 : 0.6}
            filter={isRevealing || data.confirmed || isHovered ? `url(#glow-${data.id})` : undefined}
            className={cn(
              data.confirmed && "animate-hexagon-glow",
              isRevealing && "animate-pulse"
            )}
            style={{ 
              stroke: cls === 'unknown' ? 'hsl(var(--muted-foreground))' : getStrokeColor(),
              transition: 'all 0.3s ease',
              filter: isRevealing 
                ? 'drop-shadow(0 0 6px hsl(var(--brand-ink) / 0.4))' 
                : (data.confirmed || isHovered) 
                  ? `drop-shadow(0 0 6px ${colors.glow})`
                  : undefined
            }}
          />

          {/* Icon */}
          <text
            x="50"
            y="32"
            textAnchor="middle"
            fontSize="18"
            className={cn("select-none", isRevealing && "hexagon-icon pulse")}
          >
            {data.icon}
          </text>

          {/* Label with category color */}
          <text
            x="50"
            y="48"
            textAnchor="middle"
            fontSize="6"
            fontWeight="600"
            style={{ fill: getLabelColor() }}
            className="uppercase tracking-wider select-none"
          >
            {data.label}
          </text>

          {/* Value */}
          <text
            x="50"
            y="60"
            textAnchor="middle"
            fontSize="7"
            fontWeight="500"
            style={{ fill: 'hsl(var(--foreground))' }}
            className="select-none"
          >
            {unknownShort
              ? (unknownShort.length > 20 ? unknownShort.substring(0, 20) + '...' : unknownShort)
              : (() => { const shown = data.displayValue ?? data.value; return shown.length > 14 ? shown.substring(0, 14) + '...' : shown; })()}
          </text>

          {/* Confidence with category color */}
          {!isRevealing && !tile && data.confidence > 0 && (
            <text
              x="50"
              y="72"
              textAnchor="middle"
              fontSize="6"
              style={{ fill: colors.primary }}
              fontStyle="italic"
              className="select-none"
            >
              {data.confidence}%
            </text>
          )}

          {/* Tile mode: how sure we are, in words and a bar. Nothing at all for Unknown tiles. */}
          {!isRevealing && tile && band && (
            <g data-testid="tile-confidence">
              <text x="50" y="70" textAnchor="middle" fontSize="5.5" fontStyle="italic" style={{ fill: colors.primary }} className="select-none">
                {band.word}
              </text>
              {[1, 2, 3, 4, 5].map((n) => (
                <rect key={n} x={34 + (n - 1) * 7} y="74" width="5" height="2" rx="1"
                  style={{ fill: colors.primary }} opacity={n <= band.bar ? 0.9 : 0.2} />
              ))}
            </g>
          )}
          {!isRevealing && tile && classLabel && (
            <text x="50" y="84" textAnchor="middle" fontSize="4.5" fontWeight="600" className="uppercase tracking-wider select-none"
              style={{ fill: cls === 'unknown' ? 'hsl(var(--muted-foreground))' : colors.primary }}>
              {classLabel}{tile.is_estimate ? ` · ${TILE_ESTIMATE_LABEL}` : ''}
            </text>
          )}
          {/* Glyph so the class never depends on texture or colour alone. */}
          {!isRevealing && tileGlyph && (
            <text x="29" y="32" textAnchor="middle" fontSize="10" fontWeight="700" aria-hidden="true"
              style={{ fill: cls === 'unknown' ? 'hsl(var(--muted-foreground))' : colors.primary }} className="select-none">
              {tileGlyph}
            </text>
          )}

          {/* Tapped marker. Tile mode: a small ring ("seen"), never the check that Verified uses. */}
          {data.confirmed && !isRevealing && tile && (
            <g transform="translate(65, 8)" data-testid="tile-seen">
              <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2" style={{ stroke: colors.primary }} />
              <circle cx="10" cy="10" r="2.5" style={{ fill: colors.primary }} />
            </g>
          )}

          {/* Confirmed checkmark with category color */}
          {data.confirmed && !isRevealing && !tile && (
            <g transform="translate(65, 8)">
              <circle cx="10" cy="10" r="10" style={{ fill: colors.primary }} />
              <path
                d="M6 10 L9 13 L15 7"
                stroke="hsl(var(--brand-white))"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
