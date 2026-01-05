import { useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';

interface HexagonProps {
  data: HexagonData;
  onConfirm: (id: string) => void;
  onHover: (data: HexagonData | null) => void;
  isRevealing?: boolean;
}

// Category color configurations
const categoryColors = {
  device: {
    primary: '#8B5CF6',      // Purple
    glow: '#A78BFA',
    gradient: ['rgba(139,92,246,0.3)', 'rgba(139,92,246,0.1)'],
    bg: ['rgba(30,10,40,0.9)', 'rgba(20,5,30,0.95)'],
  },
  network: {
    primary: '#10B981',      // Emerald/Green
    glow: '#34D399',
    gradient: ['rgba(16,185,129,0.3)', 'rgba(16,185,129,0.1)'],
    bg: ['rgba(5,30,20,0.9)', 'rgba(0,20,15,0.95)'],
  },
  privacy: {
    primary: '#EF4444',      // Red
    glow: '#F87171',
    gradient: ['rgba(239,68,68,0.3)', 'rgba(239,68,68,0.1)'],
    bg: ['rgba(40,10,10,0.9)', 'rgba(30,5,5,0.95)'],
  },
  language: {
    primary: '#3B82F6',      // Blue
    glow: '#60A5FA',
    gradient: ['rgba(59,130,246,0.3)', 'rgba(59,130,246,0.1)'],
    bg: ['rgba(10,20,40,0.9)', 'rgba(5,15,30,0.95)'],
  },
  profile: {
    primary: '#EC4899',      // Pink
    glow: '#F472B6',
    gradient: ['rgba(236,72,153,0.3)', 'rgba(236,72,153,0.1)'],
    bg: ['rgba(40,10,30,0.9)', 'rgba(30,5,20,0.95)'],
  },
  orientation: {
    primary: '#F59E0B',      // Amber/Orange
    glow: '#FBBF24',
    gradient: ['rgba(245,158,11,0.3)', 'rgba(245,158,11,0.1)'],
    bg: ['rgba(40,25,5,0.9)', 'rgba(30,18,0,0.95)'],
  },
  default: {
    primary: '#00ff41',      // Matrix green
    glow: '#00ff41',
    gradient: ['rgba(0,255,0,0.3)', 'rgba(0,255,0,0.1)'],
    bg: ['rgba(0,30,10,0.9)', 'rgba(0,15,5,0.95)'],
  },
};

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
  const colors = categoryColors[category] || categoryColors.default;

  // Pointy-top hexagon path (vertices at top and bottom)
  const hexPath = "M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z";

  // Determine stroke color based on state
  const getStrokeColor = () => {
    if (isRevealing) return '#00ff00';
    if (data.confirmed) return colors.primary;
    if (isHovered) return colors.glow;
    return '#ffffff';
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
                  <stop offset="0%" stopColor="rgba(0,255,0,0.3)" />
                  <stop offset="100%" stopColor="rgba(0,255,0,0.1)" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor={colors.bg[0]} />
                  <stop offset="100%" stopColor={colors.bg[1]} />
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
            stroke={getStrokeColor()}
            strokeWidth={isRevealing ? "3" : data.confirmed ? "3" : isHovered ? "2.5" : "2"}
            opacity={isRevealing ? 1 : data.confirmed ? 1 : isHovered ? 0.85 : 0.6}
            filter={isRevealing || data.confirmed || isHovered ? `url(#glow-${data.id})` : undefined}
            className={cn(
              data.confirmed && "animate-hexagon-glow",
              isRevealing && "animate-pulse"
            )}
            style={{ 
              transition: 'all 0.3s ease',
              filter: isRevealing 
                ? 'drop-shadow(0 0 10px #00ff00) drop-shadow(0 0 20px #00ff00)' 
                : (data.confirmed || isHovered) 
                  ? `drop-shadow(0 0 8px ${colors.glow}) drop-shadow(0 0 15px ${colors.glow})`
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
            fill={getLabelColor()}
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
            fill="#ffffff"
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
              fill={colors.primary}
              opacity={0.7}
              fontStyle="italic"
              className="select-none"
            >
              {data.confidence}%
            </text>
          )}

          {/* Confirmed checkmark with category color */}
          {data.confirmed && !isRevealing && (
            <g transform="translate(65, 8)">
              <circle cx="10" cy="10" r="10" fill={colors.primary} />
              <path
                d="M6 10 L9 13 L15 7"
                stroke="#000"
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
