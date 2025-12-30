import { useState, useEffect } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import { HexagonData } from '@/lib/deviceDetection';

interface HexagonGridProps {
  hexagons: HexagonData[];
}

export default function HexagonGrid({ hexagons: initialHexagons }: HexagonGridProps) {
  const [hexagons, setHexagons] = useState<HexagonData[]>(initialHexagons.slice(0, 7));
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);

  useEffect(() => {
    setHexagons(initialHexagons.slice(0, 7));
  }, [initialHexagons]);

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

  // Honeycomb layout matching reference image:
  // Row 0: 2 hexagons (top)
  // Row 1: 3 hexagons (middle) - offset left by half
  // Row 2: 2 hexagons (bottom) - aligned with row 0
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
  ];

  const containerWidth = hSpacing * 2 + hexWidth;
  const containerHeight = vSpacing * 2 + hexHeight;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Description text - above hexagons */}
      <div className="text-center mb-6">
        <p className="text-lg text-green-300/80">
          The PrivacyTOOL found <span className="text-green-400 font-semibold">{hexagons.length} data points</span> about you without asking.
        </p>
        <p className="text-lg text-green-300/80">
          Click the ones that are correct.
        </p>
      </div>

      {/* Honeycomb Hexagon Grid */}
      <div className="flex justify-center mb-8">
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
                className="absolute"
                style={{
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
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
        total={hexagons.length} 
      />

      {/* Voice AI */}
      <VoiceAI 
        hexagonData={hoveredHexagon} 
        confirmedCount={confirmedCount} 
        totalCount={hexagons.length}
      />
    </div>
  );
}
