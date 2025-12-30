import { useState, useEffect } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import { HexagonData } from '@/lib/deviceDetection';
import { toast } from '@/hooks/use-toast';
import { trackHexagonConfirm, trackDeepScanUnlocked } from '@/lib/analytics';

interface HexagonGridProps {
  hexagons: HexagonData[];
}

export default function HexagonGrid({ hexagons: initialHexagons }: HexagonGridProps) {
  const [hexagons, setHexagons] = useState<HexagonData[]>(initialHexagons.slice(0, 6));
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [revealingHexagon, setRevealingHexagon] = useState<HexagonData | null>(null);

  useEffect(() => {
    setHexagons(initialHexagons.slice(0, 6));
  }, [initialHexagons]);

  // Progressive reveal: show more hexagons as user confirms
  useEffect(() => {
    if (confirmedCount === 3 && hexagons.length === 6) {
      const nextHexagons = initialHexagons.slice(6, 8);
      
      trackDeepScanUnlocked(confirmedCount);
      toast({
        title: "🔓 Deep Scan Unlocked!",
        description: "Revealing deeper data points...",
        duration: 5000,
      });
      
      nextHexagons.forEach((hex, index) => {
        setTimeout(() => {
          setRevealingHexagon(hex);
          
          setTimeout(() => {
            setHexagons(prev => [...prev, hex]);
            setRevealingHexagon(null);
          }, 2000);
        }, index * 2500);
      });
    }
  }, [confirmedCount, hexagons.length, initialHexagons]);

  const handleConfirm = (id: string) => {
    setHexagons(prev => {
      const hex = prev.find(h => h.id === id);
      if (hex && !hex.confirmed) {
        trackHexagonConfirm(hex.id, hex.label, true);
        setConfirmedCount(c => c + 1);
      }
      return prev.map(h =>
        h.id === id ? { ...h, confirmed: true, confidence: Math.min(h.confidence + 5, 99) } : h
      );
    });
  };

  const handleHover = (data: HexagonData | null) => {
    setHoveredHexagon(data);
  };

  // Hexagon size for calculations
  const hexWidth = 170;
  const hexHeight = 170;
  const gap = 12;
  const hSpacing = hexWidth * 0.87 + gap;
  const vSpacing = hexHeight * 0.75 + gap;

  const positions = [
    { x: hSpacing * 0.5, y: 0 },
    { x: hSpacing * 1.5, y: 0 },
    { x: 0, y: vSpacing },
    { x: hSpacing, y: vSpacing },
    { x: hSpacing * 2, y: vSpacing },
    { x: hSpacing * 0.5, y: vSpacing * 2 },
    { x: hSpacing * 1.5, y: vSpacing * 2 },
    { x: 0, y: vSpacing * 2 },
    { x: hSpacing * 2, y: vSpacing * 2 },
  ];

  const containerWidth = hSpacing * 2 + hexWidth;
  const containerHeight = vSpacing * 2 + hexHeight;

  const revealingHexagonData: HexagonData | null = revealingHexagon ? {
    id: 'revealing',
    label: 'SCANNING...',
    value: 'Data Point Revealed',
    icon: '🔍',
    confidence: 0,
    risk: 'Analyzing deeper patterns...',
    confirmed: false,
  } : null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Title Section */}
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
          YOUR DIGITAL SHADOW
        </h2>
        <p className="text-muted-foreground">
          We found {hexagons.length} data points about you without asking.
          {confirmedCount >= 3 && hexagons.length < 8 && ' Deeper scan unlocked...'}
        </p>
      </div>

      {/* Voice AI */}
      <VoiceAI 
        hexagonData={hoveredHexagon} 
        confirmedCount={confirmedCount} 
        totalCount={Math.max(hexagons.length, 8)} 
      />

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
                  onConfirm={handleConfirm}
                  onHover={handleHover}
                />
              </div>
            );
          })}
          
          {/* Show revealing hexagon during animation */}
          {revealingHexagonData && (
            <div
              className="absolute transition-all duration-500 animate-pulse"
              style={{
                left: `${positions[hexagons.length]?.x || 0}px`,
                top: `${positions[hexagons.length]?.y || 0}px`,
              }}
            >
              <Hexagon
                data={revealingHexagonData}
                onConfirm={() => {}}
                onHover={handleHover}
              />
            </div>
          )}
        </div>
      </div>

      {/* Risk Score */}
      <RiskScore 
        confirmed={confirmedCount} 
        total={Math.max(hexagons.length, 8)} 
      />
    </div>
  );
}
