import { useEffect, useState } from 'react';
import HexagonGrid from '@/components/HexagonGrid';
import { captureDeviceData, generateHexagons, HexagonData } from '@/lib/deviceDetection';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logo from '@/assets/logo.jpeg';

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
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
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
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
        <div className="glass-card rounded-xl p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <img src={logo} alt="MyPrivacyTOOL" className="w-10 h-10 rounded-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Scan Failed</h2>
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
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="MyPrivacyTOOL" className="w-10 h-10 rounded-full object-cover" />
            <span className="text-xl text-foreground tracking-tight">
              <span className="font-normal">MyPrivacy</span><span className="font-black">TOOL.IO</span>
            </span>
          </div>
          <div className="text-sm text-muted-foreground hidden sm:block">
            Your privacy, revealed
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-12 md:py-20 px-4">
        <div className="container mx-auto text-center max-w-4xl">
          <h1 className="text-4xl md:text-6xl font-bold mb-6 text-gradient leading-tight">
            What Do Data Brokers Know About You?
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            We found information about you without asking. 
            See what attackers can find — and take back control.
          </p>
        </div>
      </section>

      {/* Hexagon Grid Section */}
      <section className="pb-12">
        <HexagonGrid hexagons={hexagons} />
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-12 bg-secondary/30">
        <div className="container mx-auto px-4 text-center">
          <p className="text-muted-foreground text-sm">
            © 2025 <span className="font-normal">MyPrivacy</span><span className="font-black">TOOL.IO</span> • Protecting Your Digital Privacy
          </p>
          <p className="text-xs text-muted-foreground/60 mt-2">
            No data is stored. All detection happens in your browser.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;