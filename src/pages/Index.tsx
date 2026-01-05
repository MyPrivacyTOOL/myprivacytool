import { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import HexagonGrid from '@/components/HexagonGrid';
import MatrixRain from '@/components/MatrixRain';
import ShadowHands from '@/components/ShadowHands';
import DeviceIcon from '@/components/DeviceIcon';
import { captureDeviceData, generateHexagonsAsync, HexagonData, DeviceData } from '@/lib/deviceDetection';
import { RefreshCw, Facebook, Twitter, Instagram, Globe, Link as LinkIcon, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logoFull from '@/assets/logo-full.png';
import logoHeader from '@/assets/logo-header.png';
import logoFooter from '@/assets/logo-footer.png';
import { 
  trackSocialClick, 
  trackFunnelStep, 
  trackDeviceProfile, 
  startSessionTimer, 
  trackSessionDuration,
  trackError,
  trackScrollToFooter
} from '@/lib/analytics';
import { useOrientation } from '@/hooks/useOrientation';
import { useDeviceMotion } from '@/hooks/useDeviceMotion';

const Index = () => {
  const [hexagons, setHexagons] = useState<HexagonData[]>([]);
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-black">
        <div className="relative mb-6">
          <div className="w-20 h-20 border-4 border-primary/30 border-t-primary rounded-full animate-spin-slow" />
        </div>
        <p className="text-lg text-white font-medium mb-2">Scanning your digital shadow...</p>
        <p className="text-sm text-green-400/70">This only takes a few seconds</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-black">
        <div className="glass-card rounded-xl p-8 text-center max-w-md bg-black/50 border border-green-500/20">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <img 
              src={logoFull} 
              alt="MyPrivacyTOOL.IO logo - Privacy awareness platform" 
              className="h-8 object-contain" 
            />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Scan Failed</h2>
          <p className="text-green-300/70 mb-6">{error}</p>
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
      {/* Full-page Matrix Rain Background */}
      <MatrixRain fadeBottom={true} />
      
      {/* Content Layer - with safe area insets for iPhone */}
      <div className="relative z-10" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Navbar */}
        <nav className="bg-white" role="navigation" aria-label="Main navigation">
          <div className="container mx-auto px-3 sm:px-4 flex items-center justify-between">
            <div className="flex items-center -my-8 sm:-my-10">
              <img 
                src={logoHeader} 
                alt="MyPrivacyTOOL.IO header logo - Digital privacy protection" 
                className="h-28 sm:h-40 md:h-48 object-contain"
                width="200"
                height="192"
              />
            </div>
            
            {/* Navigation Links */}
            <div className="flex items-center gap-2">
              <Link 
                to="/device-orientation"
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white font-medium text-xs sm:text-sm hover:opacity-90 transition-opacity shadow-md"
              >
                <Smartphone className="w-4 h-4" />
                <span className="hidden sm:inline">Device Tracking</span>
                <span className="sm:hidden">Track</span>
              </Link>
            </div>
          </div>
        </nav>

        {/* Hero Section with Shadow Hands */}
        <section className="relative h-[280px] sm:h-[350px] md:h-[500px]" aria-labelledby="hero-heading">
          <ShadowHands />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 z-10">
            <h1 
              id="hero-heading"
              className="text-2xl sm:text-4xl md:text-6xl font-bold mb-4 sm:mb-6 text-center leading-tight text-white drop-shadow-[0_0_10px_rgba(0,255,65,0.5)]"
            >
              What is your Digital Shadow?
            </h1>
          </div>
        </section>

        {/* Description Text */}
        <section className="text-center pb-4 sm:pb-6 px-4" aria-label="Introduction">
          <p className="text-sm sm:text-lg text-white">
            The <span className="text-green-400" style={{ textShadow: '0 0 10px rgba(0, 255, 65, 0.6)' }}>Privacy<span className="font-bold">TOOL</span></span> found <span className="text-green-400 font-semibold">6+ data points</span> about you without asking.
          </p>
          <p className="text-sm sm:text-lg text-white">
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
        <section className="pb-12" aria-label="Your detected data points">
          <HexagonGrid hexagons={hexagons} deviceData={deviceData || undefined} />
        </section>

        {/* Footer */}
        <footer ref={footerRef} className="py-4 mt-12 bg-white" role="contentinfo">
          <div className="container mx-auto px-4 text-center">
            <img 
              src={logoFooter} 
              alt="MyPrivacyTOOL.IO footer logo - Protecting your digital privacy" 
              className="h-20 object-contain mx-auto mb-3"
              width="150"
              height="80"
              loading="lazy"
            />
            
            {/* Social Media Icons */}
            <nav className="flex justify-center gap-3 mb-4" aria-label="Social media links">
              <a 
                href="https://www.facebook.com/MyPrivacyTOOL.IO" 
                target="_blank" 
                rel="noopener noreferrer" 
                onClick={() => trackSocialClick('facebook', 'https://www.facebook.com/MyPrivacyTOOL.IO')} 
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                aria-label="Follow us on Facebook"
              >
                <Facebook className="w-4 h-4 text-gray-600" aria-hidden="true" />
              </a>
              <a 
                href="https://twitter.com/myprivacytool" 
                target="_blank" 
                rel="noopener noreferrer" 
                onClick={() => trackSocialClick('twitter', 'https://twitter.com/myprivacytool')} 
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                aria-label="Follow us on Twitter"
              >
                <Twitter className="w-4 h-4 text-gray-600" aria-hidden="true" />
              </a>
              <a 
                href="https://www.instagram.com/myprivacytool.io/" 
                target="_blank" 
                rel="noopener noreferrer" 
                onClick={() => trackSocialClick('instagram', 'https://www.instagram.com/myprivacytool.io/')} 
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                aria-label="Follow us on Instagram"
              >
                <Instagram className="w-4 h-4 text-gray-600" aria-hidden="true" />
              </a>
              <a 
                href="https://myprivacytool.business.site/" 
                target="_blank" 
                rel="noopener noreferrer" 
                onClick={() => trackSocialClick('google_business', 'https://myprivacytool.business.site/')} 
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                aria-label="Visit our Google Business page"
              >
                <Globe className="w-4 h-4 text-gray-600" aria-hidden="true" />
              </a>
              <a 
                href="https://linktr.ee/MyPrivacyTOOL" 
                target="_blank" 
                rel="noopener noreferrer" 
                onClick={() => trackSocialClick('linktree', 'https://linktr.ee/MyPrivacyTOOL')} 
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                aria-label="Visit our Linktree"
              >
                <LinkIcon className="w-4 h-4 text-gray-600" aria-hidden="true" />
              </a>
            </nav>
            
            <p className="text-gray-600 text-xs">
              © 2025 MyPrivacyTOOL.IO • Protecting Your Digital Privacy
            </p>
            <p className="text-xs text-gray-400 mt-1">
              No data is stored. All detection happens in your browser.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Index;
