import { useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';

interface HexagonProps {
  data: HexagonData;
  onConfirm: (id: string) => void;
  onHover: (data: HexagonData | null) => void;
  isRevealing?: boolean;
}

// Category colours come from the theme tokens in index.css (--cat-<name>, --cat-<name>-tint).
const CATEGORIES = ['device','network','privacy','language','profile','orientation','fingerprint','storage','social','security','behavior','default'] as const;
type CategoryKey = typeof CATEGORIES[number];

const categoryColors = Object.fromEntries(
  CATEGORIES.map((c) => [c, {
    primary: `hsl(var(--cat-${c}))`,
    glow: `hsl(var(--cat-${c}) / 0.45)`,
    bg: [`hsl(var(--surface) / var(--surface-alpha))`, `hsl(var(--cat-${c}-tint) / var(--surface-alpha))`],
  }])
) as Record<CategoryKey, { primary: string; glow: string; bg: [string, string] }>;

export default function Hexagon({ data, onConfirm, onHover, isRevealing = false }: HexagonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (!data.confirmed && !isRevealing && data.id !== 'revealing') {
      onConfirm(data.id);
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

  // Get category colors
  const category = data.category || 'default';
  const colors = categoryColors[category as CategoryKey] || categoryColors.default;

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

  return (
    <div className={cn(
      "animate-fade-in hexagon-wrapper",
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
            !isRevealing && "cursor-pointer hover:scale-105 active:scale-95"
          )}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onTouchStart={() => setIsHovered(true)}
          onTouchEnd={() => { setIsHovered(false); onHover(null); }}
          aria-label={`${data.label}: ${data.value}. Confidence: ${data.confidence}%. ${data.confirmed ? 'Confirmed' : 'Tap to confirm'}`}
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
            fill={`url(#hexGradient-${data.id})`}
          />

          {/* Border with category-based coloring */}
          <path
            d={hexPath}
            fill="none"
            strokeWidth={isRevealing ? "3" : data.confirmed ? "3" : isHovered ? "2.5" : "2"}
            opacity={isRevealing ? 1 : data.confirmed ? 1 : isHovered ? 0.85 : 0.6}
            filter={isRevealing || data.confirmed || isHovered ? `url(#glow-${data.id})` : undefined}
            className={cn(
              data.confirmed && "animate-hexagon-glow",
              isRevealing && "animate-pulse"
            )}
            style={{ 
              stroke: getStrokeColor(),
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
            {data.value.length > 14 ? data.value.substring(0, 14) + '...' : data.value}
          </text>

          {/* Confidence with category color */}
          {!isRevealing && data.confidence > 0 && (
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

          {/* Confirmed checkmark with category color */}
          {data.confirmed && !isRevealing && (
            <g transform="translate(65, 8)">
              <circle cx="10" cy="10" r="10" style={{ fill: colors.primary }} />
              <path
                d="M6 10 L9 13 L15 7"
                stroke="#fff"
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
