import { useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';

interface HexagonProps {
  data: HexagonData;
  onConfirm: (id: string) => void;
  onHover: (data: HexagonData | null) => void;
  index: number;
}

export default function Hexagon({ data, onConfirm, onHover, index }: HexagonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (!data.confirmed) {
      onConfirm(data.id);
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    onHover(data);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    onHover(null);
  };

  // Pointy-top hexagon path (vertices at top and bottom)
  const hexPath = "M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z";

  return (
    <div 
      className="animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'forwards' }}
    >
      <svg
        viewBox="0 0 100 100"
        className={cn(
          "w-[150px] h-[150px] md:w-[170px] md:h-[170px] cursor-pointer transition-transform duration-300",
          "hover:scale-105",
          data.confirmed && "cursor-default"
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
          <linearGradient id={`hexGradient-${data.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(0,30,10,0.9)" />
            <stop offset="100%" stopColor="rgba(0,15,5,0.95)" />
          </linearGradient>
        </defs>

        {/* Background hexagon fill */}
        <path
          d={hexPath}
          fill={`url(#hexGradient-${data.id})`}
        />

        {/* Border - white/light until confirmed, then bright green */}
        <path
          d={hexPath}
          fill="none"
          stroke={data.confirmed ? "#00ff41" : isHovered ? "#a8ffba" : "#ffffff"}
          strokeWidth={data.confirmed ? "3" : "2"}
          opacity={data.confirmed ? 1 : 0.6}
          filter={data.confirmed ? `url(#glow-${data.id})` : undefined}
          className={data.confirmed ? "animate-hexagon-glow" : ""}
        />

        {/* Icon */}
        <text
          x="50"
          y="32"
          textAnchor="middle"
          fontSize="18"
          className="select-none"
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

        {/* Confidence */}
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
  );
}
