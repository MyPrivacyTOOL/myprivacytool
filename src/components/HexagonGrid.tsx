import { useState, useEffect } from 'react';
import Hexagon from './Hexagon';
import RiskScore from './RiskScore';
import { HexagonData } from '@/lib/deviceDetection';
import { toast } from '@/hooks/use-toast';

interface HexagonGridProps {
  hexagons: HexagonData[];
}

export default function HexagonGrid({ hexagons: initialHexagons }: HexagonGridProps) {
  const [hexagons, setHexagons] = useState<HexagonData[]>(initialHexagons);
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [visibleCount, setVisibleCount] = useState(6);

  useEffect(() => {
    setHexagons(initialHexagons);
  }, [initialHexagons]);

  // Reveal more hexagons after 3 confirmations
  useEffect(() => {
    if (confirmedCount >= 3 && visibleCount === 6) {
      setTimeout(() => {
        setVisibleCount(8);
        toast({
          title: "🔓 Deep Scan Unlocked!",
          description: "2 more data points revealed. Your digital shadow runs deeper than you thought...",
          duration: 5000,
        });
      }, 500);
    }
  }, [confirmedCount, visibleCount]);

  const handleConfirm = (id: string) => {
    setHexagons(prev => {
      const hex = prev.find(h => h.id === id);
      const wasConfirmed = hex?.confirmed || false;
      
      // Update confirmed count
      setConfirmedCount(c => wasConfirmed ? c - 1 : c + 1);
      
      return prev.map(h =>
        h.id === id 
          ? { ...h, confirmed: !h.confirmed, confidence: wasConfirmed ? h.confidence - 5 : Math.min(h.confidence + 5, 99) } 
          : h
      );
    });
  };

  const handleHover = (data: HexagonData | null) => {
    setHoveredHexagon(data);
  };


  // Hexagon size for calculations
  const hexWidth = 170; // md size
  const hexHeight = 170;
  
  // Gap between hexagons
  const gap = 12;
  
  // For pointy-top hexagons in honeycomb with gaps:
  // Horizontal spacing = width * 0.87 + gap
  // Vertical spacing = height * 0.75 + gap
  const hSpacing = hexWidth * 0.87 + gap;
  const vSpacing = hexHeight * 0.75 + gap;

  // Honeycomb layout:
  // Row 0: 2 hexagons (top)
  // Row 1: 3 hexagons (middle) - offset left by half
  // Row 2: 2 hexagons (bottom) - aligned with row 0
  // Row 3: 1 hexagon (bonus, center) - revealed after confirmations
  const positions = [
    // Row 0 - top 2
    { x: hSpacing * 0.5, y: 0 },
    { x: hSpacing * 1.5, y: 0 },
    // Row 1 - middle 3 (offset)
    { x: 0, y: vSpacing },
    { x: hSpacing, y: vSpacing },
    { x: hSpacing * 2, y: vSpacing },
    // Row 2 - bottom 2
    { x: hSpacing * 0.5, y: vSpacing * 2 },
    { x: hSpacing * 1.5, y: vSpacing * 2 },
    // Row 3 - bonus hexagons (revealed after 3 confirmations)
    { x: 0, y: vSpacing * 2 },
    { x: hSpacing * 2, y: vSpacing * 2 },
  ];

  const containerWidth = hSpacing * 2 + hexWidth;
  const containerHeight = vSpacing * 2 + hexHeight;

  // Get visible hexagons
  const visibleHexagons = hexagons.slice(0, visibleCount);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Honeycomb Hexagon Grid */}
      <div className="flex justify-center mb-8">
        <div 
          className="relative"
          style={{ 
            width: `${containerWidth}px`, 
            height: `${containerHeight}px` 
          }}
        >
          {visibleHexagons.map((hex, index) => {
            const pos = positions[index];
            if (!pos) return null;
            
            return (
              <div
                key={hex.id}
                className="absolute transition-all duration-500"
                style={{
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
                  opacity: index >= 6 ? 0 : 1,
                  animation: index >= 6 ? 'fadeIn 0.5s ease-out forwards' : undefined,
                }}
              >
                <Hexagon
                  data={hex}
                  index={index}
                  onConfirm={handleConfirm}
                  onHover={handleHover}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Risk Score */}
      <RiskScore 
        confirmed={confirmedCount} 
        total={visibleCount} 
      />
    </div>
  );
}
