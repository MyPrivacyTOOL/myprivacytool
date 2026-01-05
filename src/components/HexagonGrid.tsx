import { useState, useEffect, useRef, useCallback } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import LanguageIntelligencePanel from './LanguageIntelligencePanel';
import FingerprintPanel from './FingerprintPanel';
import StoragePanel from './StoragePanel';
import SocialAccountsPanel from './SocialAccountsPanel';
import SecurityPanel from './SecurityPanel';
import FinalSummaryPanel from './FinalSummaryPanel';
import DNSLeakFixGuide from './DNSLeakFixGuide';
import { HexagonData, DeviceData, getLanguageName, determineUserProfile } from '@/lib/deviceDetection';
import { calculateFingerprintUniqueness, CompositeFingerprint } from '@/lib/fingerprintDetection';
import { detectDNSLeak, DNSLeakResult } from '@/lib/securityDetection';
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
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HexagonGridProps {
  hexagons: HexagonData[];
  deviceData?: DeviceData;
}

// Define progressive reveal thresholds - Total 40 hexagons
const REVEAL_THRESHOLDS = {
  initial: 5,           // Location, Device, Browser, ISP, Time Pattern
  secondWave: 5,        // After 5 confirmations: Screen, Privacy, Connection, Battery
  languageWave: 8,      // After 8 confirmations: Language hexagons (4)
  orientationWave: 12,  // After 12 confirmations: Orientation hexagons (5)
  fingerprintWave: 17,  // After 17 confirmations: Core fingerprint hexagons (6)
  advancedFingerprintWave: 23, // After 23 confirmations: Advanced fingerprint hexagons (6)
  storageWave: 29,      // After 29 confirmations: Storage hexagons (5)
  socialWave: 34,       // After 34 confirmations: Social hexagons (5)
  securityWave: 39,     // After 39 confirmations: Security hexagons (6)
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
  
  // Storage state
  const [showStoragePanel, setShowStoragePanel] = useState(false);
  const [storageConfirmedCount, setStorageConfirmedCount] = useState(0);
  
  // Social accounts state
  const [showSocialPanel, setShowSocialPanel] = useState(false);
  const [socialConfirmedCount, setSocialConfirmedCount] = useState(0);
  
  // Security state
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const [securityConfirmedCount, setSecurityConfirmedCount] = useState(0);
  const [showDNSFixGuide, setShowDNSFixGuide] = useState(false);
  const [criticalSecurityAlert, setCriticalSecurityAlert] = useState<{
    type: 'dns' | 'webrtc' | null;
    message: string;
  } | null>(null);
  const [dnsLeakData, setDnsLeakData] = useState<DNSLeakResult | null>(null);
  
  // Final summary state
  const [showFinalSummary, setShowFinalSummary] = useState(false);
  
  // Track which reveal waves have been triggered
  const [revealWaves, setRevealWaves] = useState({
    second: false,
    language: false,
    orientation: false,
    fingerprint: false,
    advancedFingerprint: false,
    storage: false,
    social: false,
    security: false,
  });

  // Get visible hexagons based on count, with proper ordering
  const getOrderedHexagons = useCallback(() => {
    // Define category order for progressive reveal - security is last
    const categoryOrder = ['device', 'network', 'privacy', 'profile', 'language', 'orientation', 'fingerprint', 'storage', 'social', 'security'];
    
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
      revealNextWave(18, 24);
    }
    
    // Advanced fingerprint wave: After 23 confirmations
    if (confirmedCount >= REVEAL_THRESHOLDS.fingerprintWave + 6 && !revealWaves.advancedFingerprint) {
      trackFunnelStep('advanced_fingerprint_scan_triggered');
      setRevealWaves(prev => ({ ...prev, advancedFingerprint: true }));
      revealNextWave(24, 30);
    }
    
    // Storage wave: After 29 confirmations
    if (confirmedCount >= REVEAL_THRESHOLDS.advancedFingerprintWave + 6 && !revealWaves.storage) {
      trackFunnelStep('storage_scan_triggered');
      setRevealWaves(prev => ({ ...prev, storage: true }));
      revealNextWave(30, 35);
    }
    
    // Social wave: After 34 confirmations (storage complete)
    if (confirmedCount >= REVEAL_THRESHOLDS.storageWave + 5 && !revealWaves.social) {
      trackFunnelStep('social_scan_triggered');
      setRevealWaves(prev => ({ ...prev, social: true }));
      revealNextWave(35, 40);
    }
    
    // Security wave: After 39 confirmations (social complete)
    if (confirmedCount >= REVEAL_THRESHOLDS.socialWave + 5 && !revealWaves.security) {
      trackFunnelStep('security_scan_triggered');
      setRevealWaves(prev => ({ ...prev, security: true }));
      // Check for DNS leak and show critical alert if needed
      checkForCriticalSecurityIssues();
      revealNextWave(40, Math.min(46, orderedHexagons.length));
    }
    
    // Show Language panel after language hexagons confirmed
    if (confirmedCount >= 8 && !showLanguagePanel) {
      setShowLanguagePanel(true);
    }
    
    // Check for final summary (all 40+ hexagons confirmed)
    if (confirmedCount >= visibleCount && visibleCount >= 40 && !showFinalSummary) {
      trackFunnelStep('all_hexagons_confirmed');
      setShowFinalSummary(true);
    }
  }, [confirmedCount, revealWaves, orderedHexagons.length, visibleCount, showLanguagePanel, showFinalSummary, loadFingerprintData]);

  // Check for critical security issues (DNS leak, WebRTC leak)
  const checkForCriticalSecurityIssues = async () => {
    try {
      const dnsResult = await detectDNSLeak();
      setDnsLeakData(dnsResult);
      
      if (dnsResult.isLeaking) {
        setCriticalSecurityAlert({
          type: 'dns',
          message: `Your DNS is leaking to your ISP! Location exposed: ${dnsResult.actualLocation}`,
        });
        // Auto-show the fix guide after a short delay
        setTimeout(() => setShowDNSFixGuide(true), 2000);
      }
    } catch (error) {
      console.error('Security check failed:', error);
    }
  };

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
      
      // Track storage confirmations
      if (hex.category === 'storage') {
        setStorageConfirmedCount(c => {
          const newCount = c + 1;
          if (newCount >= 3 && !showStoragePanel) {
            setShowStoragePanel(true);
          }
          return newCount;
        });
      }
      
      // Track social confirmations
      if (hex.category === 'social') {
        setSocialConfirmedCount(c => {
          const newCount = c + 1;
          if (newCount >= 3 && !showSocialPanel) {
            setShowSocialPanel(true);
          }
          return newCount;
        });
      }
      
      // Track security confirmations
      if (hex.category === 'security') {
        setSecurityConfirmedCount(c => {
          const newCount = c + 1;
          if (newCount >= 3 && !showSecurityPanel) {
            setShowSecurityPanel(true);
          }
          // Check for critical issues (DNS leak, HTTP)
          const value = hex.value?.toLowerCase() || '';
          const label = hex.label?.toLowerCase() || '';
          if (label.includes('dns') && value.includes('leak')) {
            setCriticalSecurityAlert({
              type: 'dns',
              message: 'Critical: DNS leak detected! Your browsing history is exposed.',
            });
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

  const positions = generatePositions(46); // Support up to 46 hexagons (40 + 6 security)
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
    if (visibleCount <= 30) return 'Advanced fingerprinting active...';
    if (visibleCount <= 35) return 'Storage analysis running...';
    if (visibleCount <= 40) return 'Social tracking scan...';
    if (visibleCount <= 46) return 'Security vulnerability check...';
    return 'Complete analysis';
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
      {/* Critical Security Alert Banner */}
      {criticalSecurityAlert && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white py-3 px-4 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-bold">🚨 CRITICAL SECURITY ISSUE</span>
            <span className="hidden sm:inline">- {criticalSecurityAlert.message}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowDNSFixGuide(true)}
              className="bg-white text-red-600 hover:bg-gray-100"
            >
              Fix Now
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setCriticalSecurityAlert(null)}
              className="text-white hover:bg-red-700"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* DNS Leak Fix Guide Modal */}
      <DNSLeakFixGuide
        open={showDNSFixGuide}
        onOpenChange={setShowDNSFixGuide}
        currentLeak={dnsLeakData}
      />

      {/* Title Section */}
      <div className={`text-center mb-4 sm:mb-8 ${criticalSecurityAlert ? 'mt-14' : ''}`}>
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

      {/* Storage Panel - shown after confirming 3+ storage hexagons */}
      {showStoragePanel && (
        <div className="mt-8 animate-fade-in">
          <StoragePanel />
        </div>
      )}

      {/* Social Accounts Panel - shown after confirming 3+ social hexagons */}
      {showSocialPanel && (
        <div className="mt-8 animate-fade-in">
          <SocialAccountsPanel />
        </div>
      )}

      {/* Security Panel - shown after confirming 3+ security hexagons */}
      {showSecurityPanel && (
        <div className="mt-8 animate-fade-in">
          <SecurityPanel onClose={() => setShowSecurityPanel(false)} />
        </div>
      )}

      {/* Final Summary Panel - shown after all 40 hexagons confirmed */}
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
