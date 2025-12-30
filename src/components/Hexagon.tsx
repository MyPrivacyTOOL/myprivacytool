import { useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

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

  // Flat-top hexagon path
  const hexPath = "M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z";

  return (
    <div 
      className="animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'forwards' }}
    >
      <svg
        viewBox="0 0 100 100"
        className={cn(
          "w-28 h-28 md:w-32 md:h-32 cursor-pointer transition-all duration-300",
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
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <clipPath id={`hexClip-${data.id}`}>
            <path d={hexPath} />
          </clipPath>
        </defs>

        {/* Outer glow hexagon */}
        <path
          d={hexPath}
          fill="none"
          stroke={data.confirmed ? "#00ff41" : "#00ff41"}
          strokeWidth={data.confirmed ? "3" : "2"}
          opacity={data.confirmed ? 1 : 0.6}
          filter={`url(#glow-${data.id})`}
          className="animate-hexagon-glow"
        />

        {/* Inner hexagon background */}
        <path
          d={hexPath}
          fill={isHovered ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.7)"}
          stroke={data.confirmed ? "#00ff41" : isHovered ? "#00ff41" : "#00ff41"}
          strokeWidth={data.confirmed ? "2.5" : "1.5"}
          strokeOpacity={data.confirmed ? 1 : isHovered ? 0.8 : 0.5}
        />

        {/* Content group */}
        <g clipPath={`url(#hexClip-${data.id})`}>
          {/* Icon */}
          <text
            x="50"
            y="32"
            textAnchor="middle"
            fontSize="20"
            className="select-none"
          >
            {data.icon}
          </text>

          {/* Label */}
          <text
            x="50"
            y="48"
            textAnchor="middle"
            fontSize="7"
            fontWeight="600"
            fill={data.confirmed ? "#00ff41" : "#86efac"}
            className="uppercase tracking-wider select-none"
          >
            {data.label}
          </text>

          {/* Value */}
          <text
            x="50"
            y="62"
            textAnchor="middle"
            fontSize="8"
            fontWeight="500"
            fill="#ffffff"
            className="select-none"
          >
            {data.value.length > 14 ? data.value.substring(0, 14) + '...' : data.value}
          </text>

          {/* Confidence */}
          <text
            x="50"
            y="76"
            textAnchor="middle"
            fontSize="7"
            fill={data.confirmed ? "#00ff41" : "#4ade80"}
            opacity={0.8}
            className="select-none"
          >
            {data.confidence}%
          </text>
        </g>

        {/* Confirmed checkmark */}
        {data.confirmed && (
          <g transform="translate(70, 10)">
            <circle cx="10" cy="10" r="10" fill="#00ff41" />
            <path
              d="M6 10 L9 13 L14 7"
              stroke="#000"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
      </svg>

      {/* Hover hint */}
      {!data.confirmed && (
        <div className={cn(
          "text-center text-[9px] text-green-400/60 transition-opacity duration-200 mt-1",
          isHovered ? "opacity-100" : "opacity-0"
        )}>
          Click to confirm
        </div>
      )}
    </div>
  );
}
