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
          "w-[120px] h-[120px] md:w-[140px] md:h-[140px] cursor-pointer transition-transform duration-300",
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

        {/* Glowing border */}
        <path
          d={hexPath}
          fill="none"
          stroke="#00ff41"
          strokeWidth={data.confirmed ? "3" : "2"}
          opacity={data.confirmed ? 1 : isHovered ? 0.9 : 0.7}
          filter={`url(#glow-${data.id})`}
          className="animate-hexagon-glow"
        />

        {/* Icon */}
        <text
          x="50"
          y="30"
          textAnchor="middle"
          fontSize="22"
          className="select-none"
        >
          {data.icon}
        </text>

        {/* Label */}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          fontSize="8"
          fontWeight="600"
          fill={data.confirmed ? "#00ff41" : "#00ff41"}
          className="uppercase tracking-wider select-none"
        >
          {data.label}
        </text>

        {/* Value */}
        <text
          x="50"
          y="65"
          textAnchor="middle"
          fontSize="9"
          fontWeight="500"
          fill="#ffffff"
          className="select-none"
        >
          {data.value.length > 12 ? data.value.substring(0, 12) + '...' : data.value}
        </text>

        {/* Confidence */}
        <text
          x="50"
          y="80"
          textAnchor="middle"
          fontSize="8"
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
            <circle cx="12" cy="12" r="12" fill="#00ff41" />
            <path
              d="M7 12 L10 15 L17 8"
              stroke="#000"
              strokeWidth="2.5"
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
