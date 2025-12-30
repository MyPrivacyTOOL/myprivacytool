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
          "relative w-48 h-56 transition-all duration-300 ease-out cursor-pointer group",
          "hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
          data.confirmed && "cursor-default"
        )}
        aria-label={`${data.label}: ${data.value}. Confidence: ${data.confidence}%. ${data.confirmed ? 'Confirmed' : 'Click to confirm'}`}
      >
        {/* Hexagon shape with clip-path */}
        <div
          className={cn(
            "absolute inset-0 clip-hexagon transition-all duration-300",
            "border-2",
            data.confirmed
              ? "bg-success/20 border-success glow-success"
              : isHovered
              ? "bg-primary/20 border-primary glow-primary"
              : "bg-secondary/60 border-border hover:border-primary/50"
          )}
        />

        {/* Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          {/* Icon */}
          <span className="text-4xl mb-2" role="img" aria-hidden="true">
            {data.icon}
          </span>

          {/* Label */}
          <span className={cn(
            "text-xs font-semibold uppercase tracking-wider mb-1",
            data.confirmed ? "text-success" : "text-primary"
          )}>
            {data.label}
          </span>

          {/* Value */}
          <span className="text-sm font-medium text-foreground leading-tight mb-2 max-w-[140px] truncate">
            {data.value}
          </span>

          {/* Confidence */}
          <span className={cn(
            "text-xs italic",
            data.confirmed ? "text-success/80" : "text-muted-foreground"
          )}>
            {data.confidence}% confident
          </span>

          {/* Confirmed checkmark */}
          {data.confirmed && (
            <div className="absolute top-4 right-4 w-7 h-7 bg-success rounded-full flex items-center justify-center animate-check-pop">
              <Check className="w-4 h-4 text-success-foreground" />
            </div>
          )}
        </div>

        {/* Hover hint */}
        {!data.confirmed && (
          <div className={cn(
            "absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground transition-opacity duration-200",
            isHovered ? "opacity-100" : "opacity-0"
          )}>
            Click to confirm
          </div>
        )}
      </button>
    </div>
  );
}