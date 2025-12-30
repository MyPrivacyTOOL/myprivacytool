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

  return (
    <div 
      className="animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'forwards' }}
    >
      <button
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "relative w-28 h-32 md:w-32 md:h-36 transition-all duration-300 ease-out cursor-pointer group",
          "hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-transparent",
          data.confirmed && "cursor-default"
        )}
        aria-label={`${data.label}: ${data.value}. Confidence: ${data.confidence}%. ${data.confirmed ? 'Confirmed' : 'Click to confirm'}`}
      >
        {/* Glowing border effect */}
        <div 
          className={cn(
            "absolute inset-0 clip-hexagon animate-hexagon-glow",
            data.confirmed ? "opacity-100" : "opacity-70"
          )}
          style={{
            background: 'transparent',
            boxShadow: data.confirmed 
              ? '0 0 20px rgba(0, 255, 65, 0.6), inset 0 0 20px rgba(0, 255, 65, 0.1)' 
              : '0 0 15px rgba(0, 255, 65, 0.4), inset 0 0 15px rgba(0, 255, 65, 0.05)',
          }}
        />
        
        {/* Hexagon shape with clip-path */}
        <div
          className={cn(
            "absolute inset-[3px] clip-hexagon transition-all duration-300",
            data.confirmed
              ? "bg-black/70 border-2 border-primary"
              : isHovered
              ? "bg-black/80 border-2 border-green-400"
              : "bg-black/60 border-2 border-green-500/50"
          )}
        />

        {/* Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
          {/* Icon */}
          <span className="text-2xl mb-1" role="img" aria-hidden="true">
            {data.icon}
          </span>

          {/* Label */}
          <span className={cn(
            "text-[10px] font-semibold uppercase tracking-wider mb-0.5",
            data.confirmed ? "text-primary" : "text-green-300/70"
          )}>
            {data.label}
          </span>

          {/* Value */}
          <span className="text-xs font-medium text-white leading-tight mb-1 max-w-[90px] truncate">
            {data.value}
          </span>

          {/* Confidence */}
          <span className={cn(
            "text-[10px]",
            data.confirmed ? "text-primary/80" : "text-green-400/60"
          )}>
            {data.confidence}%
          </span>

          {/* Confirmed checkmark */}
          {data.confirmed && (
            <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center animate-check-pop">
              <Check className="w-3 h-3 text-primary-foreground" />
            </div>
          )}
        </div>

        {/* Hover hint */}
        {!data.confirmed && (
          <div className={cn(
            "absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-green-400/60 transition-opacity duration-200 whitespace-nowrap",
            isHovered ? "opacity-100" : "opacity-0"
          )}>
            Click to confirm
          </div>
        )}
      </button>
    </div>
  );
}