import { useState, useEffect, useRef, useCallback } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import LanguageIntelligencePanel from './LanguageIntelligencePanel';
import FingerprintPanel from './FingerprintPanel';
import FinalSummaryPanel from './FinalSummaryPanel';
import { HexagonData, DeviceData, getLanguageName, determineUserProfile } from '@/lib/deviceDetection';
import { calculateFingerprintUniqueness, CompositeFingerprint } from '@/lib/fingerprintDetection';
import { 
  initializeModel as initLanguageModel,
  analyzeLanguages,
  predictLanguagePreference,
  cachePrediction,
  getCachedPrediction,
  LanguageAnalysis,
  LanguagePrediction,
} from '@/lib/languagePredictor';
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
  deviceData?: DeviceData;
}

// Define progressive reveal thresholds
const REVEAL_THRESHOLDS = {
  initial: 5,           // Location, Device, Browser, ISP, Time Pattern
  secondWave: 5,        // After 5 confirmations: Screen, Privacy, Connection, Battery
  languageWave: 8,      // After 8 confirmations: Language hexagons (4)
  orientationWave: 12,  // After 12 confirmations: Orientation hexagons (5)
  fingerprintWave: 17,  // After 17 confirmations: Fingerprint hexagons (6)
};

export default function HexagonGrid({ hexagons: allHexagons, deviceData }: HexagonGridProps) {
  const [visibleCount, setVisibleCount] = useState(5);
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [confirmedHexagons, setConfirmedHexagons] = useState<Set<string>>(new Set());
  const [revealingHexagons, setRevealingHexagons] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  const isFirstConfirmation = useRef(true);
  
  // Language Intelligence state
  const [languageAnalysis, setLanguageAnalysis] = useState<LanguageAnalysis | null>(null);
  const [languagePrediction, setLanguagePrediction] = useState<LanguagePrediction | null>(null);
  const [isLoadingPrediction, setIsLoadingPrediction] = useState(false);
  const [showLanguagePanel, setShowLanguagePanel] = useState(false);
  
  // Fingerprint state
  const [showFingerprintPanel, setShowFingerprintPanel] = useState(false);
  const [fingerprintConfirmedCount, setFingerprintConfirmedCount] = useState(0);
  const [fingerprintData, setFingerprintData] = useState<CompositeFingerprint | null>(null);
  const [isFingerprintLoading, setIsFingerprintLoading] = useState(false);
  
  // Final summary state
  const [showFinalSummary, setShowFinalSummary] = useState(false);
  
  // Track which reveal waves have been triggered
  const [revealWaves, setRevealWaves] = useState({
    second: false,
    language: false,
    orientation: false,
    fingerprint: false,
  });

  // Get visible hexagons based on count, with proper ordering
  const getOrderedHexagons = useCallback(() => {
    // Define category order for progressive reveal
    const categoryOrder = ['device', 'network', 'privacy', 'profile', 'language', 'orientation', 'fingerprint'];
    
    // Sort hexagons by category order
    const sorted = [...allHexagons].sort((a, b) => {
      const catA = a.category || 'device';
      const catB = b.category || 'device';
      return categoryOrder.indexOf(catA) - categoryOrder.indexOf(catB);
    });
    
    return sorted;
  }, [allHexagons]);

  const orderedHexagons = getOrderedHexagons();
  const visibleHexagons = orderedHexagons.slice(0, visibleCount);

  // Lazy load fingerprint data when about to be revealed
  const loadFingerprintData = useCallback(async () => {
    if (fingerprintData || isFingerprintLoading) return;
    
    setIsFingerprintLoading(true);
    try {
      const data = await calculateFingerprintUniqueness();
      setFingerprintData(data);
    } catch (error) {
      console.error('Failed to load fingerprint data:', error);
    } finally {
      setIsFingerprintLoading(false);
    }
  }, [fingerprintData, isFingerprintLoading]);

  // Track funnel milestones and trigger progressive reveals
  useEffect(() => {
    if (confirmedCount === 3) {
      trackFunnelStep('three_confirmed');
    }
    
    // Second wave: After 5 confirmations, reveal screen/privacy/connection
    if (confirmedCount >= REVEAL_THRESHOLDS.initial && !revealWaves.second) {
      trackDeepScanUnlocked(confirmedCount);
      trackFunnelStep('deep_scan_triggered');
      setRevealWaves(prev => ({ ...prev, second: true }));
      revealNextWave(5, 9);
    }
    
    // Language wave: After 8 confirmations
    if (confirmedCount >= REVEAL_THRESHOLDS.secondWave + 3 && !revealWaves.language) {
      trackFunnelStep('language_scan_triggered');
      setRevealWaves(prev => ({ ...prev, language: true }));
      loadLanguagePrediction();
      revealNextWave(9, 13);
    }
    
    // Orientation wave: After 12 confirmations
    if (confirmedCount >= REVEAL_THRESHOLDS.languageWave + 4 && !revealWaves.orientation) {
      trackFunnelStep('orientation_scan_triggered');
      setRevealWaves(prev => ({ ...prev, orientation: true }));
      revealNextWave(13, 18);
    }
    
    // Fingerprint wave: After 17 confirmations
    if (confirmedCount >= REVEAL_THRESHOLDS.orientationWave + 5 && !revealWaves.fingerprint) {
      trackFunnelStep('fingerprint_scan_triggered');
      setRevealWaves(prev => ({ ...prev, fingerprint: true }));
      loadFingerprintData();
      revealNextWave(18, Math.min(24, orderedHexagons.length));
    }
    
    // Show Language panel after language hexagons confirmed
    if (confirmedCount >= 8 && !showLanguagePanel) {
      setShowLanguagePanel(true);
    }
    
    // Check for final summary (all visible hexagons confirmed)
    if (confirmedCount >= visibleCount && visibleCount >= 18 && !showFinalSummary) {
      trackFunnelStep('all_hexagons_confirmed');
      setShowFinalSummary(true);
    }
  }, [confirmedCount, revealWaves, orderedHexagons.length, visibleCount, showLanguagePanel, showFinalSummary, loadFingerprintData]);

  // Reveal next wave of hexagons with animation
  const revealNextWave = (startIndex: number, endIndex: number) => {
    const actualEnd = Math.min(endIndex, orderedHexagons.length);
    const newHexagons = orderedHexagons.slice(startIndex, actualEnd);
    
    // Smooth scroll to grid
    setTimeout(() => {
      gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    
    // Staggered reveal
    newHexagons.forEach((hex, index) => {
      setTimeout(() => {
        setVisibleCount(prev => Math.max(prev, startIndex + index + 1));
        setRevealingHexagons(prev => new Set(prev).add(hex.id));
        
        setTimeout(() => {
          setRevealingHexagons(prev => {
            const next = new Set(prev);
            next.delete(hex.id);
            return next;
          });
        }, 2000);
      }, index * 2000);
    });
  };

  // Load language prediction
  const loadLanguagePrediction = async () => {
    setIsLoadingPrediction(true);
    
    const cached = getCachedPrediction();
    if (cached) {
      setLanguagePrediction(cached);
      setIsLoadingPrediction(false);
      return;
    }
    
    try {
      await initLanguageModel();
      const analysis = analyzeLanguages();
      setLanguageAnalysis(analysis);
      
      const prediction = await predictLanguagePreference(analysis);
      setLanguagePrediction(prediction);
      cachePrediction(prediction);
    } catch (error) {
      console.error('Failed to load language prediction:', error);
    } finally {
      setIsLoadingPrediction(false);
    }
  };

  const handleConfirm = (id: string) => {
    if (revealingHexagons.has(id)) return;
    if (confirmedHexagons.has(id)) return;
    
    const hex = visibleHexagons.find(h => h.id === id);
    if (hex && !hex.confirmed) {
      trackActivity();
      
      if (isFirstConfirmation.current) {
        trackTimeToFirstConfirmation();
        trackFunnelStep('first_hexagon_confirmed');
        isFirstConfirmation.current = false;
      }
      
      trackHexagonConfirm(hex.id, hex.label, true);
      trackHexagonAccuracy(hex.id, hex.label, hex.confidence);
      
      setConfirmedCount(c => c + 1);
      setConfirmedHexagons(prev => new Set(prev).add(id));
      
      // Track fingerprint confirmations
      if (hex.category === 'fingerprint') {
        setFingerprintConfirmedCount(c => {
          const newCount = c + 1;
          if (newCount >= 3 && !showFingerprintPanel) {
            setShowFingerprintPanel(true);
          }
          return newCount;
        });
      }
      
      hex.confirmed = true;
      hex.confidence = Math.min(hex.confidence + 5, 99);
    }
  };

  const handleHover = (data: HexagonData | null) => {
    setHoveredHexagon(data);
  };

  const handleStartOver = () => {
    window.location.reload();
  };

  // Responsive hexagon sizing
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const hexWidth = isMobile ? 130 : 170;
  const hexHeight = isMobile ? 130 : 170;
  const gap = isMobile ? 8 : 12;
  const hSpacing = hexWidth * 0.87 + gap;
  const vSpacing = hexHeight * 0.75 + gap;

  const topPadding = 10;
  
  const generatePositions = (count: number) => {
    const positions: { x: number; y: number }[] = [];
    let currentIndex = 0;
    let row = 0;
    
    while (currentIndex < count) {
      const isEvenRow = row % 2 === 0;
      const hexagonsInRow = isMobile ? 2 : (isEvenRow ? 3 : 2);
      
      for (let col = 0; col < hexagonsInRow && currentIndex < count; col++) {
        let x: number;
        if (isMobile) {
          const offset = isEvenRow ? 0 : hSpacing * 0.5;
          x = offset + hSpacing * col;
        } else {
          if (isEvenRow) {
            x = hSpacing * col;
          } else {
            x = hSpacing * (0.5 + col);
          }
        }
        const y = topPadding + vSpacing * row;
        positions.push({ x, y });
        currentIndex++;
      }
      row++;
    }
    
    return positions;
  };

  const positions = generatePositions(30);
  const visiblePositions = positions.slice(0, visibleCount);
  const maxY = visiblePositions.length > 0 ? Math.max(...visiblePositions.map(p => p.y)) : 0;
  const containerWidth = isMobile ? (hSpacing * 1.5 + hexWidth) : (hSpacing * 2 + hexWidth);
  const containerHeight = maxY + hexHeight;

  // Get reveal phase description
  const getPhaseDescription = () => {
    if (visibleCount <= 5) return 'Initial scan...';
    if (visibleCount <= 9) return 'Deeper scan unlocked...';
    if (visibleCount <= 13) return 'Language analysis active...';
    if (visibleCount <= 18) return 'Motion tracking enabled...';
    if (visibleCount <= 24) return 'Fingerprint detection running...';
    return 'Complete analysis';
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
      {/* Title Section */}
      <div className="text-center mb-4 sm:mb-8">
        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-1 sm:mb-2">
          YOUR DIGITAL SHADOW
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          We found {visibleCount} data points about you without asking.
          {visibleCount < orderedHexagons.length && (
            <span className="text-green-400 ml-1">{getPhaseDescription()}</span>
          )}
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
          style={{ width: `${containerWidth}px`, height: `${containerHeight}px` }}
        >
          {visibleHexagons.map((hex, index) => {
            const pos = positions[index];
            if (!pos) return null;
            
            const isRevealing = revealingHexagons.has(hex.id);
            
            const displayData: HexagonData = isRevealing ? {
              ...hex,
              id: 'revealing',
              label: 'SCANNING...',
              value: hex.category === 'fingerprint' ? 'Fingerprint Analysis' :
                     hex.category === 'orientation' ? 'Motion Detection' :
                     hex.category === 'language' ? 'Language Analysis' :
                     'Data Point Revealed',
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

      {/* Risk Score - now with fingerprint data */}
      <RiskScore 
        confirmed={confirmedCount} 
        total={visibleCount}
        hexagons={visibleHexagons}
        fingerprint={fingerprintData}
      />

      {/* Panel Display Order: Language -> Fingerprint -> Final Summary */}
      
      {/* Language Intelligence Panel - shown after 8 confirmations */}
      {showLanguagePanel && (
        <div className="mt-8 animate-fade-in">
          <LanguageIntelligencePanel
            analysis={languageAnalysis}
            prediction={languagePrediction}
            isLoading={isLoadingPrediction}
          />
        </div>
      )}

      {/* Fingerprint Panel - shown after confirming 3+ fingerprint hexagons */}
      {showFingerprintPanel && (
        <div className="mt-8 animate-fade-in">
          <FingerprintPanel />
        </div>
      )}

      {/* Final Summary Panel - shown after all hexagons confirmed */}
      {showFinalSummary && (
        <div className="mt-8 animate-fade-in">
          <FinalSummaryPanel
            hexagons={visibleHexagons}
            confirmedCount={confirmedCount}
            fingerprint={fingerprintData}
            languagePrediction={languagePrediction}
            onStartOver={handleStartOver}
          />
        </div>
      )}
    </div>
  );
}
