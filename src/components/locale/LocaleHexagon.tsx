import { useState } from 'react';
import { Check } from 'lucide-react';
import { LocaleHexagonData } from '@/lib/localeDetection';

interface LocaleHexagonProps {
  data: LocaleHexagonData;
  onConfirm: (id: string) => void;
  onHover: (data: LocaleHexagonData | null) => void;
}

export default function LocaleHexagon({ data, onConfirm, onHover }: LocaleHexagonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const getCategoryColor = () => {
    switch (data.category) {
      case 'language':
        return 'from-brand to-brand';
      case 'timezone':
        return 'from-[hsl(var(--cat-language))] to-[hsl(var(--cat-language))]';
      case 'profile':
        return 'from-[hsl(var(--cat-social))] to-[hsl(var(--cat-social))]';
      case 'format':
        return 'from-risk-mid to-risk-mid';
      default:
        return 'from-brand to-brand';
    }
  };

  const handleClick = () => {
    if (!data.confirmed) {
      onConfirm(data.id);
    }
  };

  return (
    <div
      className={`
        relative w-[150px] h-[170px] cursor-pointer
        transition-all duration-300 ease-out
        ${isHovered ? 'scale-110 z-10' : 'scale-100'}
        ${data.confirmed ? 'animate-hexagon-glow' : ''}
      `}
      onClick={handleClick}
      onMouseEnter={() => {
        setIsHovered(true);
        onHover(data);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onHover(null);
      }}
      role="button"
      tabIndex={0}
      aria-label={`${data.label}: ${data.value}. ${data.confirmed ? 'Confirmed' : 'Click to confirm'}`}
    >
      {/* Hexagon Shape */}
      <div
        className={`
          absolute inset-0 clip-hexagon
          bg-gradient-to-br ${getCategoryColor()}
          transition-all duration-300
          ${data.confirmed ? 'opacity-100' : 'opacity-80'}
          ${isHovered ? 'shadow-card' : ''}
        `}
      />

      {/* Hexagon Border */}
      <div
        className={`
          absolute inset-[2px] clip-hexagon
          bg-background
          transition-colors duration-300
          ${data.confirmed ? 'bg-brand-soft' : ''}
        `}
      />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
        {data.confirmed ? (
          <div className="animate-check-pop">
            <Check className="w-8 h-8 text-brand mb-1" />
          </div>
        ) : (
          <span className="text-2xl mb-1">{data.icon}</span>
        )}
        
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {data.label}
        </span>
        
        <span className={`
          text-sm font-bold mt-1 max-w-[120px] truncate
          ${data.confirmed ? 'text-brand' : 'text-foreground'}
        `}>
          {data.value}
        </span>

        {/* Confidence Badge */}
        <div className={`
          absolute bottom-4 left-1/2 -translate-x-1/2
          px-2 py-0.5 rounded-full text-[10px] font-medium
          ${data.confidence >= 90 ? 'bg-risk-low-soft text-risk-low' :
            data.confidence >= 70 ? 'bg-risk-mid-soft text-risk-mid' :
            'bg-risk-high-soft text-risk-high'}
        `}>
          {data.confidence}%
        </div>
      </div>

      {/* Hover Tooltip */}
      {isHovered && !data.confirmed && (
        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-popover text-popover-foreground px-3 py-1.5 rounded-lg shadow-card text-xs whitespace-nowrap">
            Click to confirm
          </div>
        </div>
      )}
    </div>
  );
}
