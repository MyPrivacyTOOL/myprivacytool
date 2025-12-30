import { useState, useEffect, useRef } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import { HexagonData } from '@/lib/deviceDetection';
import { 
  trackHexagonConfirm, 
  trackDeepScanUnlocked, 
  trackFunnelStep,
  trackHexagonAccuracy,
  trackTimeToFirstConfirmation,
  trackActivity
} from '@/lib/analytics';

interface HexagonGridProps {
  hexagons: HexagonData[];
}

export default function HexagonGrid({ hexagons: allHexagons }: HexagonGridProps) {
  const [visibleCount, setVisibleCount] = useState(5);
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [revealingHexagons, setRevealingHexagons] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  const isFirstConfirmation = useRef(true);

  // Get visible hexagons based on count
  const visibleHexagons = allHexagons.slice(0, visibleCount);

  // Track funnel milestones
  useEffect(() => {
    if (confirmedCount === 3) {
      trackFunnelStep('three_confirmed');
    }
    if (confirmedCount === 5) {
      trackFunnelStep('five_confirmed');
    }
    if (confirmedCount === 8) {
      trackFunnelStep('all_hexagons_confirmed');
    }
  }, [confirmedCount]);

  // Progressive reveal: show 3 more hexagons after all 5 initial ones are confirmed
  useEffect(() => {
    if (confirmedCount === 5 && visibleCount === 5) {
      trackDeepScanUnlocked(confirmedCount);
      trackFunnelStep('deep_scan_triggered');
      
      // Smooth scroll to the grid area
      setTimeout(() => {
        gridRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 300);
      
      // Reveal 3 new hexagons with staggered animation
      const newHexagons = allHexagons.slice(5, 8);
      
      newHexagons.forEach((hex, index) => {
        setTimeout(() => {
          // Step 1: Show "revealing" state - add hexagon to visible but mark as revealing
          setVisibleCount(prev => prev + 1);
          setRevealingHexagons(prev => new Set(prev).add(hex.id));
          
          // Step 2: After 2 seconds, reveal actual data
          setTimeout(() => {
            setRevealingHexagons(prev => {
              const next = new Set(prev);
              next.delete(hex.id);
              return next;
            });
          }, 2000);
        }, index * 2500); // Stagger by 2.5 seconds
      });
    }
  }, [confirmedCount, visibleCount, allHexagons]);

  const handleConfirm = (id: string) => {
    // Don't allow confirming revealing hexagons
    if (revealingHexagons.has(id)) return;
    
    const hex = visibleHexagons.find(h => h.id === id);
    if (hex && !hex.confirmed) {
      // Track activity
      trackActivity();
      
      // Track first confirmation timing
      if (isFirstConfirmation.current) {
        trackTimeToFirstConfirmation();
        trackFunnelStep('first_hexagon_confirmed');
        isFirstConfirmation.current = false;
      }
      
      // Track hexagon confirmation
      trackHexagonConfirm(hex.id, hex.label, true);
      trackHexagonAccuracy(hex.id, hex.label, hex.confidence);
      
      setConfirmedCount(c => c + 1);
      
      // Update the hexagon's confirmed state
      hex.confirmed = true;
      hex.confidence = Math.min(hex.confidence + 5, 99);
    }
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
  const topPadding = 20;
  
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
        const y = topPadding + vSpacing * row;
        positions.push({ x, y });
        currentIndex++;
      }
      row++;
    }
    
    return positions;
  };

  // Generate positions for all possible hexagons
  const positions = generatePositions(20);
  
  // Calculate container size based on visible hexagons
  const visiblePositions = positions.slice(0, visibleCount);
  const maxY = visiblePositions.length > 0 ? Math.max(...visiblePositions.map(p => p.y)) : 0;
  const containerWidth = hSpacing * 2 + hexWidth;
  const containerHeight = maxY + hexHeight;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Title Section */}
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
          YOUR DIGITAL SHADOW
        </h2>
        <p className="text-muted-foreground">
          We found {visibleCount} data points about you without asking.
          {confirmedCount >= 5 && visibleCount < 8 && ' Deeper scan unlocked...'}
        </p>
      </div>

      {/* Voice AI */}
      <VoiceAI 
        hexagonData={hoveredHexagon} 
        confirmedCount={confirmedCount} 
        totalCount={Math.max(visibleCount, 8)} 
      />

      {/* Honeycomb Hexagon Grid */}
      <div ref={gridRef} className="flex justify-center mb-8" role="list" aria-label="Detected data points">
        <div 
          className="relative transition-all duration-500"
          style={{ 
            width: `${containerWidth}px`, 
            height: `${containerHeight}px` 
          }}
        >
          {visibleHexagons.map((hex, index) => {
            const pos = positions[index];
            if (!pos) return null;
            
            const isRevealing = revealingHexagons.has(hex.id);
            
            // Create revealing data overlay
            const displayData: HexagonData = isRevealing ? {
              ...hex,
              id: 'revealing',
              label: 'SCANNING...',
              value: 'Data Point Revealed',
              icon: '🔍',
              confidence: 0,
              risk: 'Analyzing deeper patterns...',
              confirmed: false,
            } : hex;
            
            return (
              <div
                key={hex.id}
                className={`absolute transition-all duration-500 ${isRevealing ? 'revealing-wrapper' : ''}`}
                style={{
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
                  animationDelay: `${index * 0.1}s`,
                }}
                role="listitem"
              >
                <Hexagon
                  data={displayData}
                  onConfirm={handleConfirm}
                  onHover={handleHover}
                  isRevealing={isRevealing}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Risk Score */}
      <RiskScore 
        confirmed={confirmedCount} 
        total={Math.max(visibleCount, 8)} 
      />
    </div>
  );
}
