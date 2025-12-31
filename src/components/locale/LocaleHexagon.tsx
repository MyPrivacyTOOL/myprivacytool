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
        return 'from-primary to-primary/80';
      case 'timezone':
        return 'from-blue-500 to-blue-600';
      case 'profile':
        return 'from-purple-500 to-purple-600';
      case 'format':
        return 'from-amber-500 to-amber-600';
      default:
        return 'from-primary to-primary/80';
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
          ${isHovered ? 'shadow-lg' : ''}
        `}
      />

      {/* Hexagon Border */}
      <div
        className={`
          absolute inset-[2px] clip-hexagon
          bg-background
          transition-colors duration-300
          ${data.confirmed ? 'bg-primary/10' : ''}
        `}
      />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
        {data.confirmed ? (
          <div className="animate-check-pop">
            <Check className="w-8 h-8 text-primary mb-1" />
          </div>
        ) : (
          <span className="text-2xl mb-1">{data.icon}</span>
        )}
        
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {data.label}
        </span>
        
        <span className={`
          text-sm font-bold mt-1 max-w-[120px] truncate
          ${data.confirmed ? 'text-primary' : 'text-foreground'}
        `}>
          {data.value}
        </span>

        {/* Confidence Badge */}
        <div className={`
          absolute bottom-4 left-1/2 -translate-x-1/2
          px-2 py-0.5 rounded-full text-[10px] font-medium
          ${data.confidence >= 90 ? 'bg-green-500/20 text-green-500' :
            data.confidence >= 70 ? 'bg-yellow-500/20 text-yellow-500' :
            'bg-red-500/20 text-red-500'}
        `}>
          {data.confidence}%
        </div>
      </div>

      {/* Hover Tooltip */}
      {isHovered && !data.confirmed && (
        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-popover text-popover-foreground px-3 py-1.5 rounded-lg shadow-lg text-xs whitespace-nowrap">
            Click to confirm
          </div>
        </div>
      )}
    </div>
  );
}
