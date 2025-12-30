import { useState, useEffect } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import { HexagonData } from '@/lib/deviceDetection';

interface HexagonGridProps {
  hexagons: HexagonData[];
}

export default function HexagonGrid({ hexagons: initialHexagons }: HexagonGridProps) {
  const [hexagons, setHexagons] = useState<HexagonData[]>(initialHexagons.slice(0, 6));
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);

  useEffect(() => {
    if (confirmedCount >= 3 && hexagons.length === 6 && initialHexagons.length > 6) {
      const timer = setTimeout(() => {
        setHexagons(initialHexagons.slice(0, 8));
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [confirmedCount, hexagons.length, initialHexagons]);

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

  // Honeycomb positions for 7 hexagons (center + 6 around)
  // Using the pattern from reference: top-left, top-right, middle-left, center, middle-right, bottom-left, bottom-right
  const honeycombPositions = [
    { row: 0, col: 0, offset: true },   // Top left
    { row: 0, col: 1, offset: true },   // Top right
    { row: 1, col: -0.5, offset: false }, // Middle left
    { row: 1, col: 0.5, offset: false },  // Center
    { row: 1, col: 1.5, offset: false },  // Middle right
    { row: 2, col: 0, offset: true },   // Bottom left
    { row: 2, col: 1, offset: true },   // Bottom right
  ];

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-[0_0_10px_rgba(0,255,65,0.5)]">
          YOUR DIGITAL SHADOW
        </h2>
        <p className="text-lg text-green-300/80 max-w-2xl mx-auto">
          We found <span className="text-green-400 font-semibold">{hexagons.length} data points</span> about you without asking. 
          Click the ones that are correct.
        </p>
      </div>

      {/* Risk Score */}
      <RiskScore 
        score={riskScore} 
        confirmed={confirmedCount} 
        total={hexagons.length} 
      />

      {/* Honeycomb Hexagon Grid */}
      <div className="flex justify-center my-12">
        <div className="relative" style={{ width: '320px', height: '340px' }}>
          {hexagons.slice(0, 7).map((hex, index) => {
            const pos = honeycombPositions[index];
            if (!pos) return null;
            
            // Tighter hexagon spacing for real honeycomb effect
            const hexSize = 112; // Base size for positioning
            const horizontalSpacing = hexSize * 0.78;
            const verticalSpacing = hexSize * 0.68;
            
            const left = pos.col * horizontalSpacing + (pos.offset ? horizontalSpacing / 2 : 0);
            const top = pos.row * verticalSpacing;
            
            return (
              <div
                key={hex.id}
                className="absolute"
                style={{
                  left: `${left + 45}px`,
                  top: `${top}px`,
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

      {/* Voice AI */}
      <VoiceAI 
        hexagonData={hoveredHexagon} 
        confirmedCount={confirmedCount} 
        totalCount={hexagons.length}
      />
    </div>
  );
}
