import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import Hexagon from './Hexagon';
import VoiceAI from './VoiceAI';
import RiskScore from './RiskScore';
import { HexagonData, DeviceData, getLanguageName, determineUserProfile, generateHexagonsAsync } from '@/lib/deviceDetection';
import HexagonExplanation from './HexagonExplanation';
import StrangerGuessCard from './StrangerGuessCard';
import { generateFindings } from '@/lib/strangerGuess';
import { DNS_BANNER } from '@/lib/scanCopy';
import { interestRank } from '@/lib/hexagonInterestOrder';
import { buildTeaser } from '@/lib/exposureCopy';
import { calculateFingerprintUniqueness, CompositeFingerprint } from '@/lib/fingerprintDetection';
import { detectDNSLeak, DNSLeakResult } from '@/lib/securityDetection';
import { startBehaviorTracking, stopBehaviorTracking, getAllBehaviorData } from '@/lib/behaviorDetection';
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
  trackScanCompleted,
  trackHexagonAccuracy,
  trackTimeToFirstConfirmation,
  trackActivity,
  trackScanStarted
} from '@/lib/analytics';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scanCounts } from '../../shared/hexagon-registry/counts.js';
import { hexTileV2Enabled, hexScreenV2Enabled } from '@/config/hexagonTile';
import { toTile, riskProfile, riskProfileParts, withUserStatement, withGuessAnswer, cannotCheckLast, HexagonTile, type GuessOutcome } from '@/lib/hexagonTile';
import { guessCheckFor, type DeviceCheckResult } from '@/lib/guessCheck';
import GuessCheckCard from './hexagon/GuessCheckCard';
import { fixStepFor } from '@/lib/hexagonFix';
import NextStepCard from './hexagon/NextStepCard';
import DetailLadder, { type DetailLevel } from './hexagon/DetailLadder';
import HexagonHelp from './hexagon/HexagonHelp';
import { captureContext, forgetPendingHexagon } from '@/lib/webScan';
import { footprintsCueEnabled } from '@/config/footprints';
import FootprintsCue from './FootprintsCue';

// MPC-7200: below-the-fold panels (recharts / PDF export) load on demand, not with the home page.
const StoragePanel = lazy(() => import('./StoragePanel'));
const LanguageIntelligencePanel = lazy(() => import('./LanguageIntelligencePanel'));
const FingerprintPanel = lazy(() => import('./FingerprintPanel'));
const SocialAccountsPanel = lazy(() => import('./SocialAccountsPanel'));
const SecurityPanel = lazy(() => import('./SecurityPanel'));
const BehaviorPanel = lazy(() => import('./BehaviorPanel'));
const DNSLeakFixGuide = lazy(() => import('./DNSLeakFixGuide'));
const FinalSummaryPanel = lazy(() => import('./FinalSummaryPanel'));

interface HexagonGridProps {
  hexagons: HexagonData[];
  deviceData?: DeviceData;
}

// Define progressive reveal thresholds. The hexagon total shown to the user comes from the registry (HEXAGON_COUNT).
// FINAL_SUMMARY_MIN_VISIBLE is the wave boundary after which the behavior wave has been revealed, not a count of hexagons.
const FINAL_SUMMARY_MIN_VISIBLE = 46;
// CK-7805: the 'what a stranger could guess' card appears with the language panel.
const STRANGER_CARD_MIN_CONFIRMED = 8;
// CK-7805 (owner suggestion): the fingerprint panel waits for 8 fingerprint confirmations, not 3.
const FINGERPRINT_PANEL_MIN_CONFIRMED = 8;

// Phase 2: the steps the "Show more hexagons" button moves through (the same wave boundaries the taps used to reach).
const UNLOCK_STEPS = [5, 8, 12, 17, 23, 29, 34, 39, 45];

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
  behaviorWave: 45,     // After 45 confirmations: Behavior hexagons (6)
};

export default function HexagonGrid({ hexagons: allHexagons, deviceData }: HexagonGridProps) {
  // MPC-7916: honest tiles (colour, transparency and words say how we know). Off unless the flag is on.
  const v2 = useMemo(() => hexTileV2Enabled(), []);
  // MPC-7916 Phase 2: one job per screen. Hexagons first; more hexagons on a button, not on taps; one next step at a time;
  // everything else (panels, the stranger card, the score) out of the way. Built on the honest tiles.
  const screenV2 = useMemo(() => v2 && hexScreenV2Enabled(), [v2]);
  // The footprints cue (the Path): off unless the switch is on. Not shown on the one-job-per-screen layout.
  const footprintsCue = useMemo(() => footprintsCueEnabled() && !screenV2, [screenV2]);
  const [toldFixed, setToldFixed] = useState<Set<string>>(new Set());
  // Guess check (prototype): the visitor's answer and/or their device's verdict, per guessed tile. Kept in this tab only, never sent or stored.
  const [guessState, setGuessState] = useState<Record<string, { answer?: 'yes' | 'no'; device?: DeviceCheckResult }>>({});
  const [laterIds, setLaterIds] = useState<Set<string>>(new Set());
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(1);
  const [unlockCount, setUnlockCount] = useState(0);
  const [visibleCount, setVisibleCount] = useState(5);
  const [hoveredHexagon, setHoveredHexagon] = useState<HexagonData | null>(null);
  // CK-7805: a tap selects a hexagon so its explanation stays visible on touch screens (no hover there).
  const [selectedHexagonId, setSelectedHexagonId] = useState<string | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [confirmedHexagons, setConfirmedHexagons] = useState<Set<string>>(new Set());
  const [revealingHexagons, setRevealingHexagons] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  const isFirstConfirmation = useRef(true);
  // Synchronous guard so rapid double-clicks on one hexagon count once
  const confirmedIdsRef = useRef<Set<string>>(new Set());
  
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
  const dnsGuideMounted = useRef(false);
  if (showDNSFixGuide) dnsGuideMounted.current = true;
  const [criticalSecurityAlert, setCriticalSecurityAlert] = useState<{
    type: 'dns' | 'webrtc' | null;
    message: string;
  } | null>(null);
  const [dnsLeakData, setDnsLeakData] = useState<DNSLeakResult | null>(null);
  
  // Final summary state
  const [showFinalSummary, setShowFinalSummary] = useState(false);
  
  // Behavior state
  const [showBehaviorPanel, setShowBehaviorPanel] = useState(false);
  const [behaviorConfirmedCount, setBehaviorConfirmedCount] = useState(0);
  
  // Real-time behavior updates
  const [behaviorUpdateTrigger, setBehaviorUpdateTrigger] = useState(0);
  
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
    behavior: false,
  });

  // Get visible hexagons based on count, with proper ordering
  const getOrderedHexagons = useCallback(() => {
    // CK-7799: most interesting first (see hexagonInterestOrder.ts). Ids not on the list keep the old
    // category order after the listed ones. Array.sort is stable, so ties keep their incoming order.
    const categoryOrder = ['device', 'network', 'privacy', 'profile', 'language', 'orientation', 'fingerprint', 'storage', 'social', 'security', 'behavior'];

    const sorted = [...allHexagons].sort((a, b) => {
      const byInterest = interestRank(a.id) - interestRank(b.id);
      if (byInterest !== 0) return byInterest;
      const catA = a.category || 'device';
      const catB = b.category || 'device';
      return categoryOrder.indexOf(catA) - categoryOrder.indexOf(catB);
    });

    // With the honest tiles on, tiles that a web page cannot check go last, so a visitor is not met by a row of grey (kept from main).
    return v2 ? cannotCheckLast(sorted) : sorted;
  }, [allHexagons, v2]);

  // Confirmation is derived from React state, not stored on the hexagon objects,
  // so it survives the parent regenerating `allHexagons` (orientation/motion updates).
  const orderedHexagons = useMemo(
    () => getOrderedHexagons().map(h =>
      confirmedHexagons.has(h.id)
        // MPC-7916: a tap is "seen", not a confirmation, so with the honest tiles on it no longer adds to the confidence.
        ? { ...h, confirmed: true, confidence: v2 ? h.confidence : Math.min(h.confidence + 5, 99) }
        : { ...h, confirmed: false }
    ),
    [getOrderedHexagons, confirmedHexagons, v2]
  );
  const visibleHexagons = orderedHexagons.slice(0, visibleCount);
  // MPC-7471-F2: X (confirmed), Y (checked) and Z (total) for THIS scan, from the registry and the whole scan, not the part revealed so far.
  // One snapshot feeds the summary card, the popup, the share text and the PDF.
  const counts = useMemo(
    () => scanCounts(orderedHexagons, { confirmedIds: confirmedHexagons, ctx: captureContext(allHexagons) }),
    [orderedHexagons, confirmedHexagons, allHexagons]
  );

  // MPC-7916: what each visible tile says, decided in one place from the captured value and the registry.
  const tiles = useMemo(() => {
    const map = new Map<string, HexagonTile>();
    if (!v2) return map;
    const ctx = captureContext(allHexagons);
    for (const h of visibleHexagons) {
      const t = toTile({ id: h.id, value: h.value }, ctx);
      // The visitor said a red tile is fixed: their word, shown lighter than a check, until we check again.
      const g = guessState[h.id];
      // The device's verdict beats the visitor's word; a "near" verdict changes nothing.
      const outcome: GuessOutcome | null = g?.device?.verdict === 'agrees' ? 'device_agrees' : g?.device?.verdict === 'far' ? 'device_far' : g?.answer ?? null;
      map.set(h.id, t.kind === 'needs_fixing' && toldFixed.has(h.id) ? withUserStatement(t) : outcome ? withGuessAnswer(t, outcome) : t);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2, allHexagons, visibleCount, toldFixed, guessState]);
  // Phase 2: the red tiles still waiting, in the order they appear. The first one is the next step.
  const stepsLeft = useMemo(
    () => (screenV2
      ? visibleHexagons.filter((h) => tiles.get(h.id)?.kind === 'needs_fixing' && !laterIds.has(h.id))
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenV2, tiles, laterIds, visibleCount]
  );
  const currentStep = stepsLeft[0];
  const profileParts = useMemo(() => riskProfileParts(riskProfile([...tiles.values()])), [tiles]);
  const selectedHexagon = selectedHexagonId ? visibleHexagons.find(h => h.id === selectedHexagonId) ?? null : null;
  const strangerFindings = useMemo(
    () => (confirmedCount >= STRANGER_CARD_MIN_CONFIRMED
      ? generateFindings({ deviceData, hexagons: v2 ? visibleHexagons.filter((h) => !['not_checked', 'couldnt_check', 'cant_check_here'].includes(tiles.get(h.id)?.kind ?? '')) : visibleHexagons, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '' })
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirmedCount >= STRANGER_CARD_MIN_CONFIRMED, deviceData]
  );

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
  // Phase 2: the waves follow the visitor's "Show more hexagons" button, never a count of taps.
  const progressCount = screenV2 ? unlockCount : confirmedCount;
  useEffect(() => {
    if (progressCount === 3) {
      trackFunnelStep('three_confirmed');
    }
    
    // Second wave: After 5 confirmations, reveal screen/privacy/connection
    if (progressCount >= REVEAL_THRESHOLDS.initial && !revealWaves.second) {
      trackDeepScanUnlocked(confirmedCount);
      trackFunnelStep('deep_scan_triggered');
      setRevealWaves(prev => ({ ...prev, second: true }));
      revealNextWave(5, 9);
    }
    
    // Language wave: After 8 confirmations
    if (progressCount >= REVEAL_THRESHOLDS.secondWave + 3 && !revealWaves.language) {
      trackFunnelStep('language_scan_triggered');
      setRevealWaves(prev => ({ ...prev, language: true }));
      loadLanguagePrediction();
      revealNextWave(9, 13);
    }
    
    // Orientation wave: After 12 confirmations
    if (progressCount >= REVEAL_THRESHOLDS.languageWave + 4 && !revealWaves.orientation) {
      trackFunnelStep('orientation_scan_triggered');
      setRevealWaves(prev => ({ ...prev, orientation: true }));
      revealNextWave(13, 18);
    }
    
    // Fingerprint wave: After 17 confirmations
    if (progressCount >= REVEAL_THRESHOLDS.orientationWave + 5 && !revealWaves.fingerprint) {
      trackFunnelStep('fingerprint_scan_triggered');
      setRevealWaves(prev => ({ ...prev, fingerprint: true }));
      loadFingerprintData();
      revealNextWave(18, 24);
    }
    
    // Advanced fingerprint wave: After 23 confirmations
    if (progressCount >= REVEAL_THRESHOLDS.fingerprintWave + 6 && !revealWaves.advancedFingerprint) {
      trackFunnelStep('advanced_fingerprint_scan_triggered');
      setRevealWaves(prev => ({ ...prev, advancedFingerprint: true }));
      revealNextWave(24, 30);
    }
    
    // Storage wave: After 29 confirmations
    if (progressCount >= REVEAL_THRESHOLDS.advancedFingerprintWave + 6 && !revealWaves.storage) {
      trackFunnelStep('storage_scan_triggered');
      setRevealWaves(prev => ({ ...prev, storage: true }));
      revealNextWave(30, 35);
    }
    
    // Social wave: After 34 confirmations (storage complete)
    if (progressCount >= REVEAL_THRESHOLDS.storageWave + 5 && !revealWaves.social) {
      trackFunnelStep('social_scan_triggered');
      setRevealWaves(prev => ({ ...prev, social: true }));
      revealNextWave(35, 40);
    }
    
    // Security wave: After 39 confirmations (social complete)
    if (progressCount >= REVEAL_THRESHOLDS.socialWave + 5 && !revealWaves.security) {
      trackFunnelStep('security_scan_triggered');
      setRevealWaves(prev => ({ ...prev, security: true }));
      // Check for DNS leak and show critical alert if needed
      checkForCriticalSecurityIssues();
      revealNextWave(40, 46);
    }
    
    // Behavior wave: After 45 confirmations (security complete)
    if (progressCount >= REVEAL_THRESHOLDS.securityWave + 6 && !revealWaves.behavior) {
      trackFunnelStep('behavior_scan_triggered');
      setRevealWaves(prev => ({ ...prev, behavior: true }));
      revealNextWave(46, Math.min(52, orderedHexagons.length));
    }
    
    // Show Language panel after language hexagons confirmed
    if (confirmedCount >= 8 && !showLanguagePanel) {
      setShowLanguagePanel(true);
    }
    
    // Check for final summary (all 46+ hexagons confirmed)
    if (confirmedCount >= visibleCount && visibleCount >= FINAL_SUMMARY_MIN_VISIBLE && !showFinalSummary) {
      trackFunnelStep('all_hexagons_confirmed');
      trackScanCompleted(visibleCount);
      setShowFinalSummary(true);
      // MPC-7471-F1: the congratulations banner and confetti moved into the one scan-complete dialog (EmailCaptureModal).
    }
  }, [confirmedCount, progressCount, revealWaves, orderedHexagons.length, visibleCount, showLanguagePanel, showFinalSummary, loadFingerprintData, v2]);

  // Start behavior tracking on mount
  useEffect(() => {
    startBehaviorTracking();
    
    // Update behavior hexagons every 2 seconds
    const behaviorInterval = setInterval(() => {
      setBehaviorUpdateTrigger(prev => prev + 1);
    }, 2000);
    
    return () => {
      stopBehaviorTracking();
      clearInterval(behaviorInterval);
    };
  }, []);

  // Check for critical security issues (DNS leak, WebRTC leak)
  const checkForCriticalSecurityIssues = async () => {
    try {
      const dnsResult = await detectDNSLeak();
      setDnsLeakData(dnsResult);
      
      if (dnsResult.isLeaking) {
        setCriticalSecurityAlert({
          type: 'dns',
          message: DNS_BANNER,
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

  // Footprints cue: remove one footprint. The step is forgotten, not just hidden: the hexagon goes back to unconfirmed (tap to take the step
  // again), its progress and any answer given to it are undone, and it is taken out of the scan held in this browser so it cannot be saved.
  const handleRemoveFootprint = (id: string) => {
    if (!confirmedHexagons.has(id)) return;
    const hex = orderedHexagons.find(h => h.id === id);
    confirmedIdsRef.current.delete(id);
    setConfirmedHexagons(prev => { const next = new Set(prev); next.delete(id); return next; });
    setConfirmedCount(c => Math.max(0, c - 1));
    setGuessState(prev => { if (!(id in prev)) return prev; const next = { ...prev }; delete next[id]; return next; });
    setToldFixed(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
    setLaterIds(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
    const down = (c: number) => Math.max(0, c - 1);
    if (hex?.category === 'fingerprint') setFingerprintConfirmedCount(down);
    if (hex?.category === 'storage') setStorageConfirmedCount(down);
    if (hex?.category === 'social') setSocialConfirmedCount(down);
    if (hex?.category === 'security') setSecurityConfirmedCount(down);
    if (hex?.category === 'behavior') setBehaviorConfirmedCount(down);
    forgetPendingHexagon(id);
    if (hex) trackHexagonConfirm(hex.id, hex.label, false, v2 ? tiles.get(hex.id)?.kind : undefined);
  };

  const handleConfirm = (id: string) => {
    if (revealingHexagons.has(id)) return;
    if (confirmedIdsRef.current.has(id)) return;
    
    const hex = visibleHexagons.find(h => h.id === id);
    if (hex && !hex.confirmed) {
      confirmedIdsRef.current.add(id);
      trackActivity();
      
      if (isFirstConfirmation.current) {
        trackScanStarted();
        trackTimeToFirstConfirmation();
        trackFunnelStep('first_hexagon_confirmed');
        isFirstConfirmation.current = false;
      }
      
      // With the honest tiles on a tap is "seen". The event is still sent (as on main) with the tile kind, so the funnel can tell a tap on
      // a grey tile from a tap on a red one.
      trackHexagonConfirm(hex.id, hex.label, true, v2 ? tiles.get(hex.id)?.kind : undefined);
      trackHexagonAccuracy(hex.id, hex.label, hex.confidence);
      
      setConfirmedCount(c => c + 1);
      setConfirmedHexagons(prev => new Set(prev).add(id));
      
      // Track fingerprint confirmations
      if (hex.category === 'fingerprint') {
        setFingerprintConfirmedCount(c => {
          const newCount = c + 1;
          if (newCount >= FINGERPRINT_PANEL_MIN_CONFIRMED && !showFingerprintPanel) {
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
              message: DNS_BANNER,
            });
          }
          return newCount;
        });
      }
      
      // Track behavior confirmations
      if (hex.category === 'behavior') {
        setBehaviorConfirmedCount(c => {
          const newCount = c + 1;
          if (newCount >= 3 && !showBehaviorPanel) {
            setShowBehaviorPanel(true);
          }
          return newCount;
        });
      }
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

  const positions = generatePositions(52); // Support up to 52 hexagons (46 + 6 behavior)
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
    if (visibleCount <= 52) return 'Behavior analysis active...';
    return 'Complete analysis';
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
      {/* Critical Security Alert Banner */}
      {!screenV2 && criticalSecurityAlert && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-brand-near-black text-brand-white border-b border-brand-dark-border py-3 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-bold">Security notice</span>
            <span className="hidden sm:inline">- {criticalSecurityAlert.message}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowDNSFixGuide(true)}
              className="bg-primary text-primary-foreground hover:bg-primary-hover hover:text-brand-white"
            >
              See how to fix
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setCriticalSecurityAlert(null)}
              className="text-brand-white hover:bg-brand-dark-border hover:text-brand-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* DNS Leak Fix Guide Modal */}
      {/* Mounted on first open and kept mounted so the dialog's close animation still plays. */}
      {dnsGuideMounted.current && (
        <Suspense fallback={null}>
          <DNSLeakFixGuide
            open={showDNSFixGuide}
            onOpenChange={setShowDNSFixGuide}
            currentLeak={dnsLeakData}
          />
        </Suspense>
      )}

      {/* Title Section */}
      <div className={`text-center mb-4 sm:mb-8 ${!screenV2 && criticalSecurityAlert ? 'mt-14' : ''}`}>
        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-1 sm:mb-2">
          YOUR DIGITAL SHADOW
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          {v2
            ? `Showing ${visibleCount} hexagons. Grey means we could not check it.`
            : buildTeaser(orderedHexagons.map(h => h.id), Object.fromEntries(orderedHexagons.map(h => [h.id, h.label.toLowerCase()])))}
          {visibleCount < orderedHexagons.length && (
            <span className="text-brand ml-1">{getPhaseDescription()}</span>
          )}
        </p>
      </div>

      {/* MPC-7916: the risk profile. Counts, never a score: no percentage, no "N of M", no Low / Medium / High. */}
      {v2 && !screenV2 ? (
        <div className="max-w-xl mx-auto mb-4 px-4" data-testid="risk-profile">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1 text-center">Your risk profile</p>
          <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-mono" aria-live="polite" aria-atomic="true">
            {profileParts.map((p, i) => (
              <span key={p.key} data-testid={`risk-profile-${p.key}`}>
                {i > 0 && <span aria-hidden="true" className="mr-4">·</span>}{p.text}
              </span>
            ))}
          </p>
        </div>
      ) : v2 ? null : (
      <div className="max-w-md mx-auto mb-4 px-4" data-testid="confirmation-progress">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-muted-foreground">Confirmed</span>
          <span className="font-mono font-semibold text-success" aria-live="polite" aria-atomic="true" data-testid="confirmation-counter">{confirmedCount}/{visibleCount}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Confirmed data points"
          aria-valuemin={0}
          aria-valuemax={visibleCount}
          aria-valuenow={confirmedCount}
          aria-valuetext={`${confirmedCount} of ${visibleCount} data points confirmed`}
          className="h-2 bg-green-900/30 rounded-full overflow-hidden border border-green-500/20"
        >
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500 ease-out"
            style={{ width: `${visibleCount > 0 ? Math.min(100, (confirmedCount / visibleCount) * 100) : 0}%` }}
            data-testid="confirmation-progress-fill"
          />
        </div>
      </div>
      )}

      {/* Voice AI. Phase 2: closed by default, so the hexagons come first. */}
      {screenV2 ? (
        <details className="max-w-md mx-auto mb-4 px-4" data-testid="voice-details">
          <summary className="cursor-pointer text-sm text-muted-foreground text-center">Ask Alice, the voice guide</summary>
      <VoiceAI 
          hexagonData={hoveredHexagon} 
          tile={v2 && hoveredHexagon ? tiles.get(hoveredHexagon.id) : undefined}
          confirmedCount={confirmedCount} 
          totalCount={Math.max(visibleCount, 8)} 
        />
        </details>
      ) : (
      <VoiceAI 
        hexagonData={hoveredHexagon} 
        tile={v2 && hoveredHexagon ? tiles.get(hoveredHexagon.id) : undefined}
        confirmedCount={confirmedCount} 
        totalCount={Math.max(visibleCount, 8)} 
      />
      )}

      {/* CK-7805: constant-height box above the grid: shows the tapped or hovered hexagon's meaning without shifting or covering the grid. */}
      <HexagonExplanation
        hexagon={hoveredHexagon ?? selectedHexagon}
        tile={v2 && (hoveredHexagon ?? selectedHexagon) ? tiles.get((hoveredHexagon ?? selectedHexagon)!.id) : undefined}
      />

      {/* Guess check (prototype): a guess is only worth showing if it can be made true. Shown for the selected guessed tile that has a check. */}
      {v2 && selectedHexagon && guessCheckFor(selectedHexagon.id) && ['our_guess', 'you_confirmed', 'device_agrees', 'guess_wrong'].includes(tiles.get(selectedHexagon.id)?.kind ?? '') && (() => {
        const g = guessState[selectedHexagon.id];
        const spec = guessCheckFor(selectedHexagon.id)!;
        const answered = g?.device?.verdict === 'agrees' ? 'device_agrees' : g?.device?.verdict === 'far' ? 'device_far' : g?.answer ?? null;
        const loc = deviceData?.location;
        return (
          <GuessCheckCard
            key={selectedHexagon.id}
            label={selectedHexagon.label}
            value={selectedHexagon.displayValue ?? selectedHexagon.value}
            spec={spec}
            guess={loc && (loc.latitude || loc.longitude) ? { lat: loc.latitude, lon: loc.longitude } : undefined}
            answered={answered}
            onAnswer={(a) => setGuessState((prev) => ({ ...prev, [selectedHexagon.id]: { ...prev[selectedHexagon.id], answer: a } }))}
            onDevice={(r) => setGuessState((prev) => ({ ...prev, [selectedHexagon.id]: { ...prev[selectedHexagon.id], device: r } }))}
          />
        );
      })()}

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
                  onSelect={(d) => setSelectedHexagonId(d.id)}
                  isRevealing={isRevealing}
                  tile={v2 ? tiles.get(hex.id) : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>


      {footprintsCue && (
        <FootprintsCue
          footprints={[...confirmedHexagons].flatMap((id) => {
            const h = orderedHexagons.find((o) => o.id === id);
            return h ? [{ id: h.id, label: h.label }] : [];
          })}
          onRemove={handleRemoveFootprint}
          className="mb-8"
        />
      )}

      {screenV2 && (
        <>
          <div className="max-w-xl mx-auto mb-4 px-4" data-testid="risk-profile">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1 text-center">Your risk profile</p>
            <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-mono" aria-live="polite" aria-atomic="true">
              {profileParts.map((p, i) => (
                <span key={p.key} data-testid={`risk-profile-${p.key}`}>
                  {i > 0 && <span aria-hidden="true" className="mr-4">·</span>}{p.text}
                </span>
              ))}
            </p>
          </div>

          {visibleCount < orderedHexagons.length && (
            <div className="text-center mb-6">
              <button
                type="button"
                data-testid="show-more"
                onClick={() => setUnlockCount((c) => UNLOCK_STEPS.find((t) => t > c) ?? c)}
                className="rounded-lg border border-surface-border px-4 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Show more hexagons
              </button>
            </div>
          )}

          {criticalSecurityAlert && (
            <div className="max-w-xl mx-auto mb-4 rounded-xl border border-dashed border-[hsl(var(--tile-purple))] bg-surface p-3 text-sm" data-testid="dns-note">
              <p className="font-semibold text-foreground">About the DNS leak and WebRTC hexagons · our guess</p>
              <p className="text-muted-foreground">{criticalSecurityAlert.message} This is a guess, not a check.</p>
              <button
                type="button"
                onClick={() => setShowDNSFixGuide(true)}
                className="mt-2 underline text-foreground focus-visible:outline focus-visible:outline-2"
              >
                See how to fix
              </button>
            </div>
          )}

          {currentStep ? (
            <NextStepCard
              key={currentStep.id}
              label={currentStep.label}
              step={fixStepFor(currentStep.id)}
              position={1}
              total={stepsLeft.length}
              onDone={() => setToldFixed((prev) => new Set(prev).add(currentStep.id))}
              onLater={() => setLaterIds((prev) => new Set(prev).add(currentStep.id))}
            />
          ) : (
            laterIds.size > 0 && (
              <div className="text-center mb-6">
                <button
                  type="button"
                  onClick={() => setLaterIds(new Set())}
                  className="underline text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2"
                  data-testid="show-skipped"
                >
                  Show the {laterIds.size} step{laterIds.size === 1 ? '' : 's'} I skipped
                </button>
              </div>
            )
          )}

          <DetailLadder
            rows={visibleHexagons.map((h) => ({ hexagon: h, tile: tiles.get(h.id)! })).filter((r) => r.tile)}
            level={detailLevel}
            onLevel={setDetailLevel}
          />

          <div className="text-center mb-8"><HexagonHelp /></div>
        </>
      )}

      {!screenV2 && strangerFindings.length > 0 && <StrangerGuessCard findings={strangerFindings} />}

      {/* Risk Score - now with fingerprint data */}
      {/* MPC-7916: the percentage and "Medium Risk" card gives a rating from partly checked data, so it is replaced by the risk profile above. */}
      {!v2 && (
        <RiskScore 
          confirmed={confirmedCount} 
          total={visibleCount}
          counts={counts}
          hexagons={visibleHexagons}
          fingerprint={fingerprintData}
        />
      )}

      {/* Panel Display Order: Language -> Fingerprint -> Final Summary */}
      
      {/* Language Intelligence Panel - shown after 8 confirmations */}
      {!screenV2 && showLanguagePanel && (
        <div className="mt-8 animate-fade-in">
          <Suspense fallback={null}>
            <LanguageIntelligencePanel
              analysis={languageAnalysis}
              prediction={languagePrediction}
              isLoading={isLoadingPrediction}
            />
          </Suspense>
        </div>
      )}

      {/* Fingerprint Panel - shown after confirming 3+ fingerprint hexagons */}
      {!screenV2 && showFingerprintPanel && (
        <div className="mt-8 animate-fade-in">
          <Suspense fallback={null}>
            <FingerprintPanel />
          </Suspense>
        </div>
      )}

      {/* Storage Panel - shown after confirming 3+ storage hexagons */}
      {!screenV2 && showStoragePanel && (
        <div className="mt-8 animate-fade-in">
          <Suspense fallback={null}>
            <StoragePanel />
          </Suspense>
        </div>
      )}

      {/* Social Accounts Panel - shown after confirming 3+ social hexagons */}
      {!screenV2 && showSocialPanel && (
        <div className="mt-8 animate-fade-in">
          <Suspense fallback={null}>
            <SocialAccountsPanel />
          </Suspense>
        </div>
      )}

      {/* Security Panel - shown after confirming 3+ security hexagons */}
      {!screenV2 && showSecurityPanel && (
        <div className="mt-8 animate-fade-in">
          <Suspense fallback={null}>
            <SecurityPanel onClose={() => setShowSecurityPanel(false)} />
          </Suspense>
        </div>
      )}

      {/* Behavior Panel - shown after confirming 3+ behavior hexagons */}
      {!screenV2 && showBehaviorPanel && (
        <div className="mt-8 animate-fade-in">
          <Suspense fallback={null}>
            <BehaviorPanel onClose={() => setShowBehaviorPanel(false)} />
          </Suspense>
        </div>
      )}

      {/* Final Summary Panel - shown after all hexagons confirmed */}
      {!v2 && showFinalSummary && (
        <div className="mt-8 animate-fade-in">
          <Suspense fallback={null}>
            <FinalSummaryPanel
              hexagons={visibleHexagons}
              confirmedCount={confirmedCount}
              counts={counts}
              tiles={v2 ? tiles : undefined}
              fingerprint={fingerprintData}
              languagePrediction={languagePrediction}
              onStartOver={handleStartOver}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
