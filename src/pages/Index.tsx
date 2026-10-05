import { useEffect, useState, useRef, useMemo } from 'react';
import HexagonGrid from '@/components/HexagonGrid';
import ShadowHands from '@/components/ShadowHands';
import DeviceIcon from '@/components/DeviceIcon';
import FederatedLearningModal, { shouldShowFederatedModal } from '@/components/FederatedLearningModal';
import { captureDeviceData, generateHexagonsAsync, HexagonData, DeviceData } from '@/lib/deviceDetection';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
import { useOrientation } from '@/hooks/useOrientation';
import { useDeviceMotion } from '@/hooks/useDeviceMotion';

const Index = () => {
  const [hexagons, setHexagons] = useState<HexagonData[]>([]);
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFederatedModal, setShowFederatedModal] = useState(false);
  const federatedCheckDone = useRef(false);
  const footerRef = useRef<HTMLElement>(null);
  const footerTracked = useRef(false);

  // Real-time orientation and motion hooks
  const orientation = useOrientation();
  const { motion } = useDeviceMotion();

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

    async function loadDeviceData() {
      try {
        setLoading(true);
        setError(null);
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

  // Load HubSpot embed script dynamically
  useEffect(() => {
    const scriptId = 'hs-forms-embed';
    if (document.getElementById(scriptId)) return;
    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://js-na2.hsforms.net/forms/embed/246502821.js';
    script.defer = true;
    document.body.appendChild(script);
    return () => {
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

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
        <div className="relative mb-6">
          <div className="w-20 h-20 border-4 border-primary/30 border-t-primary rounded-full animate-spin-slow" />
        </div>
        <p className="text-lg text-foreground font-medium mb-2">Scanning your digital shadow...</p>
        <p className="text-sm text-muted-foreground">This only takes a few seconds</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
        <div className="glass-card rounded-xl p-8 text-center max-w-md border border-surface-border shadow-card">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <img 
              src={logoFull} 
              alt="MyPrivacyTOOL" 
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
              className="text-2xl sm:text-4xl md:text-6xl font-bold mb-4 sm:mb-6 text-center leading-tight text-foreground"
            >
              Your data is everywhere. See where. Take it back.
            </h1>
          </div>
        </section>

        {/* Description Text */}
        <section className="text-center pb-4 sm:pb-6 px-4" aria-label="Introduction">
          <p className="text-sm sm:text-lg text-foreground">
            <span className="text-brand font-semibold">MyPrivacyTOOL</span> found <span className="text-brand font-semibold">6+ data points</span> about you without asking.
          </p>
          <p className="text-sm sm:text-lg text-foreground">
            Click the ones that are correct.
          </p>
        </section>

        {/* Live Device Tracking Hero */}
        <section className="py-4 sm:py-8 px-4" aria-label="Real-time device tracking">
          <div className="max-w-[280px] sm:max-w-sm mx-auto">
            <DeviceIcon 
              deviceType={liveDeviceData?.device?.type || 'Smartphone'}
              rotationAngle={orientation.angle}
              beta={motion.beta}
              gamma={motion.gamma}
            />
          </div>
        </section>

        {/* Hexagon Grid Section */}
        <section id="how-it-works" className="pb-12" aria-label="Your detected data points">
          <HexagonGrid hexagons={hexagons} deviceData={deviceData || undefined} />
        </section>

        {/* Journey teaser */}
        <section className="pb-12 px-4" aria-labelledby="journey-teaser-heading">
          <div className="max-w-2xl mx-auto text-center rounded-2xl border border-surface-border bg-brand-soft p-6 sm:p-8">
            <h2 id="journey-teaser-heading" className="text-xl sm:text-2xl font-bold text-foreground mb-2">
              Get clean before you go agentic
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mb-5">
              Eight steps from seeing your footprint to bringing AI agents on board safely.
            </p>
            <Button asChild>
              <Link to="/journey">See your journey</Link>
            </Button>
          </div>
        </section>

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
              The scan runs in your browser and its results aren't stored on our
              servers. We only store what you choose to submit, such as your email
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