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

  // Progressive reveal: show more hexagons as user confirms
  useEffect(() => {
    if (confirmedCount >= 3 && hexagons.length === 6 && initialHexagons.length > 6) {
      // Reveal 2 more hexagons after 3 confirmations
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

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
          YOUR DIGITAL SHADOW
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          We found <span className="text-matrix font-semibold">{hexagons.length} data points</span> about you without asking. 
          Click the ones that are correct.
        </p>
      </div>

      {/* Risk Score */}
      <RiskScore 
        score={riskScore} 
        confirmed={confirmedCount} 
        total={hexagons.length} 
      />

      {/* Hexagon Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8 justify-items-center my-12">
        {hexagons.map((hex, index) => (
          <Hexagon
            key={hex.id}
            data={hex}
            index={index}
            onConfirm={handleConfirm}
            onHover={handleHover}
          />
        ))}
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