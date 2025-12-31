import { useState } from 'react';
import LocaleHexagon from './LocaleHexagon';
import { LocaleHexagonData } from '@/lib/localeDetection';

interface LocaleHexagonGridProps {
  hexagons: LocaleHexagonData[];
  onConfirm: (id: string) => void;
  onHexagonHover: (data: LocaleHexagonData | null) => void;
}

export default function LocaleHexagonGrid({ hexagons, onConfirm, onHexagonHover }: LocaleHexagonGridProps) {
  const [hoveredHexagon, setHoveredHexagon] = useState<LocaleHexagonData | null>(null);

  // Hexagon size for calculations
  const hexWidth = 150;
  const hexHeight = 170;
  const gap = 10;
  const hSpacing = hexWidth * 0.87 + gap;
  const vSpacing = hexHeight * 0.75 + gap;

  // Generate honeycomb pattern positions
  const generatePositions = (count: number) => {
    const positions: { x: number; y: number }[] = [];
    let currentIndex = 0;
    let row = 0;
    
    while (currentIndex < count) {
      const isEvenRow = row % 2 === 0;
      const hexagonsInRow = isEvenRow ? 3 : 2;
      
      for (let col = 0; col < hexagonsInRow && currentIndex < count; col++) {
        let x: number;
        if (isEvenRow) {
          x = hSpacing * col;
        } else {
          x = hSpacing * (0.5 + col);
        }
        const y = vSpacing * row;
        positions.push({ x, y });
        currentIndex++;
      }
      row++;
    }
    
    return positions;
  };

  const positions = generatePositions(hexagons.length);
  
  // Calculate container size
  const maxX = Math.max(...positions.map(p => p.x));
  const maxY = Math.max(...positions.map(p => p.y));
  const containerWidth = maxX + hexWidth + 20;
  const containerHeight = maxY + hexHeight + 20;

  const handleHover = (data: LocaleHexagonData | null) => {
    setHoveredHexagon(data);
    onHexagonHover(data);
  };

  return (
    <div className="flex flex-col items-center">
      {/* Hovered Hexagon Description */}
      <div className="h-16 mb-4 flex items-center justify-center">
        {hoveredHexagon && (
          <div className="text-center animate-fade-in max-w-md">
            <p className="text-sm text-muted-foreground">{hoveredHexagon.description}</p>
          </div>
        )}
      </div>

      {/* Hexagon Grid */}
      <div className="flex justify-center">
        <div 
          className="relative"
          style={{ 
            width: `${containerWidth}px`, 
            height: `${containerHeight}px` 
          }}
        >
          {hexagons.map((hex, index) => {
            const pos = positions[index];
            if (!pos) return null;
            
            return (
              <div
                key={hex.id}
                className="absolute transition-all duration-500 animate-fade-in-up"
                style={{
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
                  animationDelay: `${index * 0.1}s`,
                }}
              >
                <LocaleHexagon
                  data={hex}
                  onConfirm={onConfirm}
                  onHover={handleHover}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirmation Progress */}
      <div className="mt-6 text-center">
        <div className="text-sm text-muted-foreground">
          {hexagons.filter(h => h.confirmed).length} of {hexagons.length} signals confirmed
        </div>
      </div>
    </div>
  );
}
