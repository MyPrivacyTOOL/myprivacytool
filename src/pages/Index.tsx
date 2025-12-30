import { useEffect, useState } from 'react';
import HexagonGrid from '@/components/HexagonGrid';
import MatrixRain from '@/components/MatrixRain';
import ShadowHands from '@/components/ShadowHands';
import { captureDeviceData, generateHexagons, HexagonData } from '@/lib/deviceDetection';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logoFull from '@/assets/logo-full.png';

const Index = () => {
  const [hexagons, setHexagons] = useState<HexagonData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDeviceData() {
      try {
        setLoading(true);
        setError(null);
        const data = await captureDeviceData();
        const hexagonData = generateHexagons(data);
        setHexagons(hexagonData);
      } catch (err) {
        console.error('Error capturing device data:', err);
        setError('Unable to detect device information. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    }

    loadDeviceData();
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
            <img src={logoFull} alt="MyPrivacyTOOL.IO" className="h-8 object-contain" />
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
      
      {/* Content Layer */}
      <div className="relative z-10">
        {/* Navbar */}
        <nav className="bg-white border-b border-border">
          <div className="container mx-auto px-4 flex items-center justify-center">
            <div className="flex items-center">
              <img src={logoFull} alt="MyPrivacyTOOL.IO" className="h-40 md:h-48 object-contain" />
            </div>
          </div>
        </nav>

        {/* Hero Section with Shadow Hands */}
        <section className="relative h-[400px] md:h-[500px]">
          <ShadowHands />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 z-10">
            <h1 className="text-4xl md:text-6xl font-bold mb-6 text-center leading-tight text-white drop-shadow-[0_0_10px_rgba(0,255,65,0.5)]">
              What is your Digital Shadow?
            </h1>
          </div>
        </section>

        {/* Hexagon Grid Section */}
        <section className="pb-12">
          <HexagonGrid hexagons={hexagons} />
        </section>

        {/* Footer */}
        <footer className="border-t border-green-500/20 py-8 mt-12 bg-black/80">
          <div className="container mx-auto px-4 text-center">
            <img src={logoFull} alt="MyPrivacyTOOL.IO" className="h-8 object-contain mx-auto mb-4" />
            <p className="text-green-300/70 text-sm">
              © 2025 MyPrivacyTOOL.IO • Protecting Your Digital Privacy
            </p>
            <p className="text-xs text-green-400/40 mt-2">
              No data is stored. All detection happens in your browser.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Index;
