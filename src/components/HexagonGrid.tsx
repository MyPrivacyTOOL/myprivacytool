import { useState, useEffect, useRef } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import { HexagonData } from '@/lib/deviceDetection';
import { trackHexagonConfirm, trackDeepScanUnlocked } from '@/lib/analytics';

interface HexagonGridProps {
  hexagons: HexagonData[];
}

export default function HexagonGrid({ hexagons: initialHexagons }: HexagonGridProps) {
  // TEMPORARY: Show all 20 hexagons for template preview
  const [hexagons, setHexagons] = useState<HexagonData[]>(() => {
    // Generate 20 placeholder hexagons for preview
    const placeholders: HexagonData[] = [];
    for (let i = 0; i < 20; i++) {
      placeholders.push({
        id: `hex-${i + 1}`,
        label: `HEXAGON ${i + 1}`,
        value: `Position ${i + 1}`,
        icon: '🔷',
        confidence: 50,
        risk: 'Template hexagon',
        confirmed: false,
      });
    }
    return placeholders;
  });
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [revealingHexagon, setRevealingHexagon] = useState<HexagonData | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // DISABLED FOR TEMPLATE PREVIEW
  // useEffect(() => {
  //   setHexagons(initialHexagons.slice(0, 6));
  // }, [initialHexagons]);

  // Progressive reveal: show more hexagons as user confirms
  useEffect(() => {
    if (confirmedCount === 3 && hexagons.length === 6) {
      const nextHexagons = initialHexagons.slice(6, 8);
      
      trackDeepScanUnlocked(confirmedCount);
      
      // Smooth scroll to the grid area
      setTimeout(() => {
        gridRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 300);
      
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

  // Generate positions dynamically for 3-2-3-2 honeycomb pattern (3 on top)
  const topPadding = 20; // Space between top hexagons and container edge
  
  const generatePositions = (count: number) => {
    const positions: { x: number; y: number }[] = [];
    let currentIndex = 0;
    let row = 0;
    
    while (currentIndex < count) {
      const isEvenRow = row % 2 === 0;
      const hexagonsInRow = isEvenRow ? 3 : 2; // 3 on even rows, 2 on odd rows
      
      for (let col = 0; col < hexagonsInRow && currentIndex < count; col++) {
        let x: number;
        if (isEvenRow) {
          // 3-hexagon rows: starts at 0
          x = hSpacing * col;
        } else {
          // 2-hexagon rows: centered, offset by 0.5
          x = hSpacing * (0.5 + col);
        }
        const y = topPadding + vSpacing * row;
        positions.push({ x, y });
        currentIndex++;
      }
      row++;
    }
    
    return positions;
  };

  // Generate 20 positions for template display
  const positions = generatePositions(20);
  
  // Calculate container size based on positions
  const maxY = positions.length > 0 ? Math.max(...positions.map(p => p.y)) : 0;
  const containerWidth = hSpacing * 2 + hexWidth;
  const containerHeight = maxY + hexHeight;

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
      <div ref={gridRef} className="flex justify-center mb-8">
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
