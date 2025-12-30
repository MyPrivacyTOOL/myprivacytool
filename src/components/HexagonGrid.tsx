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
    setHexagons(prev =>
      prev.map(hex =>
        hex.id === id 
          ? { ...hex, confirmed: true, confidence: Math.min(hex.confidence + 5, 99) } 
          : hex
      )
    );
    setConfirmedCount(prev => prev + 1);
  };

  const handleHover = (data: HexagonData | null) => {
    setHoveredHexagon(data);
  };

  const riskScore = hexagons.length > 0 
    ? Math.round((hexagons.filter(h => h.confirmed).length / hexagons.length) * 10)
    : 0;

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
          We found <span className="text-green-400 font-semibold">{hexagons.length} data points</span> about you without asking.
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

      {/* Title - below hexagons */}
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-[0_0_10px_rgba(0,255,65,0.5)]">
          YOUR DIGITAL SHADOW
        </h2>
      </div>

      {/* Risk Score */}
      <RiskScore 
        score={riskScore} 
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
