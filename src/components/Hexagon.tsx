import { useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { HexagonTile, tileAriaLabel, tileIcon } from '@/lib/hexagonTile';
import { cn } from '@/lib/utils';

interface HexagonProps {
  data: HexagonData;
  onConfirm: (id: string) => void;
  onHover: (data: HexagonData | null) => void;
  isRevealing?: boolean;
  /** CK-7805: called on every tap or click so the explanation stays on screen (touch has no hover). */
  onSelect?: (data: HexagonData) => void;
  /**
   * MPC-7916: when given, the tile is drawn from it (colour = meaning, transparency = how we know, words not a percentage).
   * When absent the hexagon looks and behaves exactly as before.
   */
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

  // MPC-7916: the honest tile. Not used while the hexagon is revealing (it shows a placeholder).
  const t = !isRevealing ? tile : undefined;
  const tileHsl = t ? `hsl(var(--tile-${t.colour}))` : '';
  const tileSolidColoured = !!t && t.level === 'solid' && t.colour !== 'grey';
  const tileFill = !t
    ? ''
    : t.colour === 'grey'
      ? 'hsl(var(--surface) / var(--surface-alpha))'
      : t.level === 'solid'
        ? tileHsl
        : `hsl(var(--tile-${t.colour}) / ${t.level === 'medium' ? 0.42 : 0.16})`;
  // Grey text uses the muted foreground so it stays readable; colour carries the rest.
  const tileLabelColor = !t ? '' : tileSolidColoured ? 'hsl(var(--brand-white))' : t.colour === 'grey' ? 'hsl(var(--muted-foreground))' : tileHsl;
  const tileValueColor = !t ? '' : tileSolidColoured ? 'hsl(var(--brand-white))' : 'hsl(var(--foreground))';
  const tileBadgeFill = !t ? '' : tileSolidColoured ? 'hsl(var(--brand-white))' : tileHsl;
  const tileBadgeGlyph = !t ? '' : tileSolidColoured ? tileHsl : 'hsl(var(--brand-white))';
  // With a tile, a tap only means "seen": nothing is drawn as confirmed.
  const confirmedVisual = !t && data.confirmed;

  // Determine stroke color based on state
  const getStrokeColor = () => {
    if (t) return tileHsl;
    if (isRevealing) return 'hsl(var(--brand-ink))';
    if (data.confirmed) return colors.primary;
    if (isHovered) return colors.glow;
    return colors.primary;
  };

  // Determine label color based on category
  const getLabelColor = () => {
    if (t) return tileLabelColor;
    if (data.confirmed) return colors.primary;
    return colors.primary;
  };

  const shownValue = data.displayValue ?? data.value;
  const valueText = t && !t.showValue ? '—' : shownValue;

  return (
    <div className={cn(
      "animate-fade-in hexagon-wrapper",
      confirmedVisual && "confirmed",
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
            confirmedVisual && !isRevealing && "animate-hexagon-confirm",
            t?.kind === 'our_guess' && "tile-breathe"
          )}
          role={isRevealing ? undefined : 'button'}
          tabIndex={isRevealing ? -1 : 0}
          aria-pressed={isRevealing || t ? undefined : !!data.confirmed}
          data-tile-kind={t?.kind}
          onKeyDown={handleKeyDown}
          onFocus={() => !isRevealing && onHover(data)}
          onBlur={() => onHover(null)}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onTouchStart={() => setIsHovered(true)}
          onTouchEnd={() => { setIsHovered(false); onHover(null); }}
          aria-label={t
            ? tileAriaLabel(data.label, shownValue, t)
            : `${data.label}: ${data.displayValue ?? data.value}. Confidence: ${data.confidence}%. ${data.confirmed ? 'Confirmed' : 'Tap to confirm'}`}
        >
          <defs>
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

          {/* Background hexagon fill */}
          <path
            d={hexPath}
            fill={t ? tileFill : `url(#hexGradient-${data.id})`}
          />

          {/* Border with category-based coloring */}
          <path
            d={hexPath}
            fill="none"
            strokeWidth={t ? (tileSolidColoured ? "3" : "2.5") : isRevealing ? "3" : data.confirmed ? "3" : isHovered ? "2.5" : "2"}
            opacity={t ? 1 : isRevealing ? 1 : data.confirmed ? 1 : isHovered ? 0.85 : 0.6}
            filter={!t && (isRevealing || data.confirmed || isHovered) ? `url(#glow-${data.id})` : undefined}
            className={cn(
              confirmedVisual && "animate-hexagon-glow",
              isRevealing && "animate-pulse"
            )}
            style={{
              stroke: getStrokeColor(),
              transition: 'all 0.3s ease',
              filter: t
                ? undefined
                : isRevealing
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
            {t ? tileIcon(data.id, data.icon, t.kind) : data.icon}
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
            style={{ fill: t ? tileValueColor : 'hsl(var(--foreground))' }}
            className="select-none"
          >
            {(() => { return valueText.length > 14 ? valueText.substring(0, 14) + '...' : valueText; })()}
          </text>

          {/* Confidence with category color. With a tile this is a line of words instead: how we know, never a number. */}
          {t ? (
            <text
              x="50"
              y="72"
              textAnchor="middle"
              fontSize={t.line.length > 18 ? 5 : 6}
              style={{ fill: getLabelColor() }}
              fontStyle="italic"
              className="select-none"
              data-testid="tile-line"
            >
              {t.line}
            </text>
          ) : (
            !isRevealing && data.confidence > 0 && (
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
            )
          )}

          {/* Tile badge: a symbol, so colour is never the only clue. */}
          {t && (
            <g transform="translate(65, 8)" aria-hidden="true">
              <circle cx="10" cy="10" r="10" style={{ fill: tileBadgeFill }} />
              <text
                x="10"
                y="10.5"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="12"
                fontWeight="700"
                style={{ fill: tileBadgeGlyph }}
                className="select-none"
              >
                {t.glyph}
              </text>
            </g>
          )}

          {/* Confirmed checkmark with category color */}
          {confirmedVisual && !isRevealing && (
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
