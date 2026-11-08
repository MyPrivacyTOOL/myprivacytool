import { useEffect, useState, useRef, useMemo } from 'react';
import FeatureStatus from "@/components/FeatureStatus";
import { hexTileV2Enabled } from '@/config/hexagonTile';
import { HERO_TILES_LINE1, HERO_TILES_LINE2, HERO_DASHBOARD_LINE2, heroDashboardLine1, countSentence } from '@/lib/scanCopy';
import { HEXAGON_COUNT } from '../../shared/hexagon-registry/registry.js';
import HexagonGrid from '@/components/HexagonGrid';
import { WebScanDashboard } from '@/components/dashboard/WebScanDashboard';
import { honeycombDashboardEnabled } from '@/config/honeycombDashboard';
import { deviceHeroEnabled } from '@/config/deviceHero';
import ShadowHands from '@/components/ShadowHands';
import DeviceRevealScreen from '@/components/DeviceRevealScreen';
import { identifyDevice, hedgeDeviceHexagon, readDeviceSignalsWithModel, type DeviceIdentity } from '@/lib/deviceIdentity';
import FederatedLearningModal, { shouldShowFederatedModal } from '@/components/FederatedLearningModal';
import { captureDeviceData, generateHexagonsAsync, HexagonData, DeviceData } from '@/lib/deviceDetection';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import HkStopSpamCard from '@/components/HkStopSpamCard';
import logoFull from '@/assets/logo-full.png';
import {
  trackFunnelStep,
  trackDeviceProfile,
  startSessionTimer,
  trackSessionDuration,
  trackError,
  trackScrollToFooter,
  trackNewsletterSignup
} from '@/lib/analytics';
import { afterFirstPaint } from '@/lib/idle';
import { hasConsent, onConsentChange } from '@/lib/cookieConsent';
import { markScanStarted, rememberCompletedScan, trackResults, writeFootprintScan } from '@/lib/webScan';
import ScanNumberNotice from '@/components/ScanNumberNotice';
import WelcomeBack from '@/components/WelcomeBack';
import TelegramHandoffNotice from '@/components/TelegramHandoffNotice';
import ScanSavingNotice from '@/components/ScanSavingNotice';
import { useOrientation } from '@/hooks/useOrientation';
import { useDeviceMotion } from '@/hooks/useDeviceMotion';
import { recipientScript } from '@/lib/recipientClient';

const Index = () => {
  const [hexagons, setHexagons] = useState<HexagonData[]>([]);
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFederatedModal, setShowFederatedModal] = useState(false);
  // null until the signals are read; then certain (carousel) or unknown (hexagon path)
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  // The full-screen reveal is shown until the visitor continues (or presses Escape)
  const [revealDone, setRevealDone] = useState(false);
  const federatedCheckDone = useRef(false);
  const footerRef = useRef<HTMLElement>(null);
  const footerTracked = useRef(false);

  // MPC-7470 (D12): when the scan first completes it is kept in this browser only (sessionStorage), never sent. It is saved on the server only
  // if the visitor reaches the contact step, gives an email and ticks the separate save box. Not on every live orientation refresh. Off unless VITE_SAVE_WEB_SCANS is "true".
  const scanRemembered = useRef(false);
  useEffect(() => {
    if (loading || hexagons.length === 0 || scanRemembered.current) return;
    scanRemembered.current = true;
    rememberCompletedScan(hexagons);
    writeFootprintScan(hexagons); // MPC-9898: the visitor's own values for /footprint/ (this browser only)
  }, [loading, hexagons]);

  // MPC-7493: funnel steps for a saved scan. The scan starts when the page opens; once the results are on screen we report "results viewed" and the
  // time spent there. Under D12 (MPC-7470) a scan is saved only at the contact step, so before that there is no scan number and nothing is sent.
  useEffect(() => {
    markScanStarted();
  }, []);
  // Unknown device: the Device Type hexagon asks instead of asserting the old regex guess
  const displayHexagons = useMemo(() => hedgeDeviceHexagon(hexagons, identity), [hexagons, identity]);
  const resultsShown = !loading && hexagons.length > 0;
  useEffect(() => (resultsShown ? trackResults() : undefined), [resultsShown]);

  // Real-time orientation and motion hooks
  const orientation = useOrientation();
  const { motion, permission: motionPermission, requestPermission: requestMotionPermission } = useDeviceMotion();

  // Merge live orientation/motion data into deviceData
  const liveDeviceData = useMemo(() => {
    if (!deviceData) return null;
    
    return {
      ...deviceData,
      orientation: {
        type: orientation.isPortrait ? 'portrait' as const : 'landscape' as const,
        angle: orientation.angle,
        isPortrait: orientation.isPortrait,
        isLandscape: !orientation.isPortrait,
        width: window.innerWidth,
        height: window.innerHeight,
      },
      motion: {
        alpha: motion.alpha,
        beta: motion.beta,
        gamma: motion.gamma,
      },
    };
  }, [deviceData, orientation.angle, orientation.isPortrait, motion.alpha, motion.beta, motion.gamma]);

  // Regenerate hexagons when orientation/motion changes significantly
  useEffect(() => {
    if (liveDeviceData && !loading) {
      generateHexagonsAsync(liveDeviceData).then(setHexagons);
    }
  }, [liveDeviceData, loading]);

  useEffect(() => {
    // Start session timer on mount
    startSessionTimer();
    trackFunnelStep('page_load');

    readDeviceSignalsWithModel().then((signals) => setIdentity(identifyDevice(signals)));

    async function loadDeviceData() {
      try {
        setLoading(true);
        setError(null);
        // MPC-7200: let the hero paint before the (CPU-heavy) fingerprint scan starts.
        await afterFirstPaint();
        const data = await captureDeviceData();
        setDeviceData(data);
        
        // Track device profile for analytics
        trackDeviceProfile(data as DeviceData);
        
        const hexagonData = await generateHexagonsAsync(data);
        setHexagons(hexagonData);
        
        // Track that hexagons are now visible
        trackFunnelStep('hexagons_visible', { count: hexagonData.length });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Error capturing device data:', err);
        trackError('device_detection_failed', errorMessage, {
          user_agent: navigator.userAgent,
        });
        setError('Unable to detect device information. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    }

    loadDeviceData();

    // Track session duration on page unload
    const handleBeforeUnload = () => {
      trackSessionDuration();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Track scroll to footer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !footerTracked.current) {
            trackScrollToFooter();
            footerTracked.current = true;
          }
        });
      },
      { threshold: 0.5 }
    );

    if (footerRef.current) {
      observer.observe(footerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Load HubSpot embed script only after cookie consent (Cookie Policy: HubSpot runs after consent)
  useEffect(() => {
    const scriptId = 'hs-forms-embed';
    let requested = false; // the wrapper adds the <script> a tick later; this stops a second consent event starting a second load
    const load = () => {
      if (!hasConsent() || requested || document.getElementById(scriptId)) return;
      requested = true;
      // MPC-9886: through the registry ("hubspot", basis user_action). Same consent test as before.
      void recipientScript('hubspot', 'https://js-na2.hsforms.net/forms/embed/246502821.js', { id: scriptId, defer: '' }).catch(() => { requested = false; });
    };
    load();
    const unsubscribe = onConsentChange(load);
    return () => {
      unsubscribe();
      requested = false;
      const existing = document.getElementById(scriptId);
      if (existing) existing.remove();
    };
  }, []);

  // The newsletter form is a HubSpot embed; HubSpot posts a message to the page when it submits successfully.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'hsFormCallback' && e.data?.eventName === 'onFormSubmitted') {
        trackNewsletterSignup({ source: 'home_embed' });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Check if should show federated learning modal (after 5+ predictions)
  useEffect(() => {
    if (!loading && !federatedCheckDone.current) {
      federatedCheckDone.current = true;
      // Delay check to not interrupt initial experience
      const timeout = setTimeout(() => {
        if (shouldShowFederatedModal()) {
          setShowFederatedModal(true);
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [loading]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    window.location.reload();
  };

  if (error) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
        <div className="glass-card rounded-xl p-8 text-center max-w-md border border-surface-border shadow-card">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <img 
              src={logoFull} 
              alt="MyPrivacyTOOL" 
              width={666}
              height={375}
              className="h-8 object-contain" 
            />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Scan did not finish</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Button onClick={handleRetry} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      {/* Matrix rain is mounted once in <Layout> and runs behind this whole page */}
      <div className="relative" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Hero Section with Shadow Hands */}
        <section className="relative h-[280px] sm:h-[350px] md:h-[500px]" aria-labelledby="hero-heading">
          <ShadowHands />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 z-10">
            <h1 
              id="hero-heading"
              className="max-w-4xl text-2xl sm:text-4xl md:text-6xl font-bold mb-4 sm:mb-6 text-center leading-tight text-foreground [text-wrap:balance]"
            >
              Your data is everywhere. See where. Take it back.
            </h1>
          </div>
        </section>

        {/* Description Text */}
        <section className="text-center pb-4 sm:pb-6 px-4" aria-label="Introduction">
          {hexTileV2Enabled() ? (
            <>
              <p className="text-sm sm:text-lg text-foreground">
                <span className="text-brand font-semibold">MyPrivacyTOOL</span>: {HERO_TILES_LINE1}
              </p>
              <p className="text-sm sm:text-lg text-foreground">{HERO_TILES_LINE2}</p>
            </>
          ) : honeycombDashboardEnabled() ? (
            <>
              <p className="text-sm sm:text-lg text-foreground">
                <span className="text-brand font-semibold">MyPrivacyTOOL</span>{heroDashboardLine1(HEXAGON_COUNT)}
              </p>
              <p className="text-sm sm:text-lg text-foreground">{HERO_DASHBOARD_LINE2}</p>
            </>
          ) : (
            <>
              <p className="text-sm sm:text-lg text-foreground">
                <span className="text-brand font-semibold">MyPrivacyTOOL</span> found <span className="text-brand font-semibold">6+ data points</span> about you without asking.
              </p>
              <p className="text-sm sm:text-lg text-foreground">
                Click the ones that are correct.
              </p>
            </>
          )}
          <p className="mt-2 text-xs sm:text-sm text-muted-foreground">{countSentence()}.</p>
        </section>

        {/* Device reveal: a full-screen opening moment, hidden while the experience is reworked (src/config/deviceHero.ts) */}
        {deviceHeroEnabled() && !revealDone && (
          <DeviceRevealScreen
            identity={identity}
            rotationAngle={orientation.angle}
            beta={motion.beta}
            gamma={motion.gamma}
            motionPrompt={motionPermission === 'unknown'}
            onEnableMotion={() => { void requestMotionPermission(); }}
            onDone={(jumpToSpotlight) => {
              setRevealDone(true);
              if (jumpToSpotlight && !honeycombDashboardEnabled()) {
                window.setTimeout(() => {
                  document.getElementById('hexagon-browser')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 60);
              }
            }}
          />
        )}

        {/* Hexagon Grid Section */}
        <section id="how-it-works" className="pb-12" aria-label="Your detected data points">
          {/* MPC-7200: the hero, intro and device icon do not depend on the scan, so the page renders at once and only
              this area waits. The old full-screen "Scanning..." view was swapped for the whole page when the scan
              finished, which moved the footer and cost a layout shift of ~0.93 on every visit (also delayed LCP). */}
          {loading ? (
            <div
              className="flex min-h-[70vh] flex-col items-center justify-center px-4"
              role="status"
              aria-live="polite"
            >
              <div className="relative mb-6">
                <div className="w-20 h-20 border-4 border-primary/30 border-t-primary rounded-full animate-spin-slow" />
              </div>
              <p className="text-lg text-foreground font-medium mb-2">Scanning your digital shadow...</p>
              <p className="text-sm text-muted-foreground">This only takes a few seconds</p>
            </div>
          ) : (
            <>
              {/* The scan is complete here (loading is over), which is when WebScanDashboard must mount: it keeps its own answers from then on. */}
              {honeycombDashboardEnabled() ? (
                <WebScanDashboard scanned={displayHexagons} title="Your Digital Footprint" />
              ) : (
                <HexagonGrid
                  hexagons={displayHexagons}
                  deviceData={deviceData || undefined}
                  spotlightId={deviceHeroEnabled() && identity && !identity.certain ? 'browser' : undefined}
                />
              )}
              <ScanSavingNotice variant="scan" />
              <WelcomeBack hexagons={hexagons} />
              <TelegramHandoffNotice />
              <ScanNumberNotice />
            </>
          )}
        </section>

        {/* MPC-7446: Hong Kong visitors only; hidden until the /HongKongSpam launch flag is on */}
        <HkStopSpamCard placement="home" />

        {/* Footprint teaser: /footprint/ is a static page (public/footprint), so this is a plain link, not a router Link. */}
        <section className="pb-12 px-4" aria-labelledby="footprint-teaser-heading">
          <div className="max-w-2xl mx-auto text-center rounded-2xl border border-surface-border bg-brand-soft p-6 sm:p-8">
            <h2 id="footprint-teaser-heading" className="text-xl sm:text-2xl font-bold text-foreground mb-2">
              See your footprint as a beehive
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mb-5">
              Open the curtain and watch the 54 data points appear one by one.<FeatureStatus feature="F9" />
            </p>
            <Button asChild>
              <a href="/footprint/">Open the footprint</a>
            </Button>
          </div>
        </section>

        {/* Journey teaser */}
        <section className="pb-12 px-4" aria-labelledby="journey-teaser-heading">
          <div className="max-w-2xl mx-auto text-center rounded-2xl border border-surface-border bg-brand-soft p-6 sm:p-8">
            <h2 id="journey-teaser-heading" className="text-xl sm:text-2xl font-bold text-foreground mb-2">
              Get clean before you go agentic
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mb-5">
              Eight steps from seeing your footprint to bringing AI agents on board safely.<FeatureStatus feature="F9" state="in_build" />
            </p>
            <Button asChild>
              <Link to="/journey">See your journey</Link>
            </Button>
          </div>
        </section>

        {/* Trust strip (MPC-6545): links only, no claims beyond what /trust and /privacy already state */}
        <nav
          className="pb-4 px-4 text-center text-xs text-muted-foreground"
          aria-label="Trust and legal"
        >
          <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <li><Link to="/trust" className="underline hover:text-foreground">Trust Centre</Link></li>
            <li><Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link></li>
            <li><Link to="/cookies" className="underline hover:text-foreground">Cookie Policy</Link></li>
            <li><Link to="/terms" className="underline hover:text-foreground">Terms</Link></li>
            <li><Link to="/dpa" className="underline hover:text-foreground">DPA</Link></li>
          </ul>
        </nav>

        {/* Newsletter Sign-Up */}
        <section ref={footerRef} className="py-4 mt-12" aria-label="Newsletter sign-up">
          <div className="container mx-auto px-4 text-center">
            {/* HubSpot Newsletter Sign-Up Form */}
            <div className="max-w-md mx-auto mb-2">
              <p className="text-foreground/80 text-sm font-medium mb-3">
                Get weekly privacy tips — no spam, unsubscribe anytime.
              </p>
              <div
                className="hs-form-frame"
                data-region="na2"
                data-form-id="0861b7ed-ff70-47a9-a45a-b29be082153d"
                data-portal-id="246502821"
              />
            </div>

            <p className="text-xs text-muted-foreground mt-4 max-w-md mx-auto">
              The scan runs in your browser. We save a scan only if you tick &ldquo;save my scan&rdquo;; we then keep it for 12 months, and you can have it deleted at any time by quoting your scan number. We only store what you choose to submit, such as your email
              address, and we use analytics only with your consent.{" "}
              <a href="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </a>
            </p>
          </div>
        </section>
      </div>

      {/* Federated Learning Modal */}
      <FederatedLearningModal
        isOpen={showFederatedModal}
        onClose={() => setShowFederatedModal(false)}
        trigger="auto"
      />
    </div>
  );
};

export default Index;