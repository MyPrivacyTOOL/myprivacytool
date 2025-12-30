import { useState, useEffect } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';

interface HexagonProps {
  data: HexagonData;
  onConfirm: (id: string) => void;
  onHover: (data: HexagonData | null) => void;
}

export default function Hexagon({ data, onConfirm, onHover }: HexagonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);

  // Detect if this is a "revealing" hexagon
  useEffect(() => {
    if (data.id === 'revealing') {
      setIsRevealing(true);
    }
  }, [data.id]);

  const handleClick = () => {
    if (!data.confirmed && data.id !== 'revealing') {
      onConfirm(data.id);
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (data.id !== 'revealing') {
      onHover(data);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    onHover(null);
  };

  // Pointy-top hexagon path (vertices at top and bottom)
  const hexPath = "M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z";

  return (
    <div className={cn(
      "animate-fade-in hexagon-wrapper",
      isRevealing && "hexagon revealing revealing-wrapper"
    )}>
      <div className={cn(
        "hexagon-inner relative",
        isRevealing && "hexagon-content"
      )}>
        <svg
          viewBox="0 0 100 100"
          className={cn(
            "w-[150px] h-[150px] md:w-[170px] md:h-[170px] transition-transform duration-300",
            data.id !== 'revealing' && "cursor-pointer hover:scale-105"
          )}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          aria-label={`${data.label}: ${data.value}. Confidence: ${data.confidence}%. ${data.confirmed ? 'Confirmed' : 'Click to confirm'}`}
        >
          <defs>
            <filter id={`glow-${data.id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            {/* Revealing gradient - bright matrix green */}
            <linearGradient id={`hexGradient-${data.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
              {isRevealing ? (
                <>
                  <stop offset="0%" stopColor="rgba(0,255,0,0.3)" />
                  <stop offset="100%" stopColor="rgba(0,255,0,0.1)" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="rgba(0,30,10,0.9)" />
                  <stop offset="100%" stopColor="rgba(0,15,5,0.95)" />
                </>
              )}
            </linearGradient>
          </defs>

          {/* Background hexagon fill */}
          <path
            d={hexPath}
            fill={`url(#hexGradient-${data.id})`}
          />

          {/* Border - matrix green for revealing, normal states otherwise */}
          <path
            d={hexPath}
            fill="none"
            stroke={isRevealing ? "#00ff00" : data.confirmed ? "#00ff41" : isHovered ? "#00ff41" : "#ffffff"}
            strokeWidth={isRevealing ? "3" : data.confirmed ? "3" : isHovered ? "2.5" : "2"}
            opacity={isRevealing ? 1 : data.confirmed ? 1 : isHovered ? 0.85 : 0.6}
            filter={isRevealing || data.confirmed || isHovered ? `url(#glow-${data.id})` : undefined}
            className={cn(
              data.confirmed && "animate-hexagon-glow",
              isRevealing && "animate-pulse"
            )}
            style={{ 
              transition: 'all 0.3s ease',
              filter: isRevealing ? 'drop-shadow(0 0 10px #00ff00) drop-shadow(0 0 20px #00ff00)' : undefined
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

        {/* Label */}
        <text
          x="50"
          y="48"
          textAnchor="middle"
          fontSize="6"
          fontWeight="600"
          fill={data.confirmed ? "#00ff41" : "#00ff41"}
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

        {/* Confidence - hide for revealing hexagons */}
        {!isRevealing && (
          <text
            x="50"
            y="72"
            textAnchor="middle"
            fontSize="6"
            fill="#00ff41"
            opacity={0.7}
            fontStyle="italic"
            className="select-none"
          >
            {data.confidence}%
          </text>
        )}

        {/* Confirmed checkmark */}
        {data.confirmed && (
          <g transform="translate(65, 8)">
            <circle cx="10" cy="10" r="10" fill="#00ff41" />
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
