import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Brain, ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LocaleHexagonGrid from '@/components/locale/LocaleHexagonGrid';
import PredictionPanel from '@/components/locale/PredictionPanel';
import PrivacyBanner from '@/components/locale/PrivacyBanner';
import LanguageSelector from '@/components/locale/LanguageSelector';
import StatsDashboard from '@/components/locale/StatsDashboard';
import { 
  detectLocaleData, 
  generateLocaleHexagons, 
  predictLanguagePreference,
  LocaleData,
  LocaleHexagonData,
  PredictionResult 
} from '@/lib/localeDetection';
import { loadModel, predict, isModelLoaded } from '@/lib/tensorflowModel';

export default function LocaleIntent() {
  const [localeData, setLocaleData] = useState<LocaleData | null>(null);
  const [hexagons, setHexagons] = useState<LocaleHexagonData[]>([]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [feedbackStats, setFeedbackStats] = useState({ correct: 0, incorrect: 0 });
  const [hoveredHexagon, setHoveredHexagon] = useState<LocaleHexagonData | null>(null);

  // Initialize on mount
  useEffect(() => {
    const initialize = async () => {
      // Load TensorFlow model
      setIsLoadingModel(true);
      await loadModel();
      
      // Detect locale data
      const data = detectLocaleData();
      setLocaleData(data);
      setSelectedLanguage(data.primaryLanguage);
      
      // Generate hexagons
      const hexagonData = generateLocaleHexagons(data);
      setHexagons(hexagonData);
      
      // Run prediction
      const predictionResult = predictLanguagePreference(data);
      
      // Also run TensorFlow model prediction (for demo)
      if (isModelLoaded()) {
        const uniqueFamilies = new Set(data.languages.map(l => l.split('-')[0]));
        await predict({
          languageCount: data.languages.length,
          hasLanguageMismatch: false,
          timezoneOffsetHours: data.timezoneOffset / 60,
          isMultilingual: uniqueFamilies.size > 1,
        });
      }
      
      setPrediction(predictionResult);
      setIsLoadingModel(false);
    };
    
    initialize();
  }, []);

  const handleConfirmHexagon = (id: string) => {
    setHexagons(prev => prev.map(hex => 
      hex.id === id ? { ...hex, confirmed: true, confidence: Math.min(hex.confidence + 5, 99) } : hex
    ));
  };

  const handleLanguageChange = (language: string) => {
    setSelectedLanguage(language);
    
    // Simulate re-prediction with new language
    if (localeData) {
      const modifiedData = { ...localeData, primaryLanguage: language };
      const newPrediction = predictLanguagePreference(modifiedData);
      setPrediction(newPrediction);
    }
  };

  const handleFeedback = (isCorrect: boolean) => {
    setFeedbackStats(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      incorrect: prev.incorrect + (isCorrect ? 0 : 1),
    }));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back to MyPrivacyTOOL</span>
          </Link>
          
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            <span className="font-bold text-lg">LocaleIntent</span>
            <span className="text-xs text-muted-foreground">Demo</span>
          </div>
          
          <div className="w-[140px]" /> {/* Spacer for centering */}
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-12 md:py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        
        <div className="container mx-auto px-4 text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            Powered by TensorFlow.js
          </div>
          
          <h1 className="text-3xl md:text-5xl font-bold mb-4">
            We Detected Your True
            <br />
            <span className="text-gradient">Language Preference</span>
          </h1>
          
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Using privacy-preserving AI to analyze your browser's locale signals
            and predict your preferred language — all without any data leaving your device.
          </p>

          {/* Live Detection Display */}
          {localeData && (
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              <div className="px-4 py-2 bg-muted/50 rounded-lg border border-border">
                <span className="text-xs text-muted-foreground block">Primary Language</span>
                <span className="font-mono font-medium">{localeData.primaryLanguage}</span>
              </div>
              <div className="px-4 py-2 bg-muted/50 rounded-lg border border-border">
                <span className="text-xs text-muted-foreground block">Timezone</span>
                <span className="font-mono font-medium">{localeData.timezone}</span>
              </div>
              <div className="px-4 py-2 bg-muted/50 rounded-lg border border-border">
                <span className="text-xs text-muted-foreground block">Languages</span>
                <span className="font-mono font-medium">{localeData.languages.length} configured</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Main Content */}
      <main className="container mx-auto px-4 pb-20 space-y-12">
        {/* Privacy Banner */}
        <PrivacyBanner />

        {/* Hexagon Grid */}
        <section>
          <h2 className="text-2xl font-bold text-center mb-2">Detected Locale Signals</h2>
          <p className="text-center text-muted-foreground mb-8">
            Click each hexagon to confirm the detection is accurate
          </p>
          <LocaleHexagonGrid 
            hexagons={hexagons} 
            onConfirm={handleConfirmHexagon}
            onHexagonHover={setHoveredHexagon}
          />
        </section>

        {/* Prediction Panel */}
        <section>
          <PredictionPanel 
            prediction={prediction} 
            isLoading={isLoadingModel}
            onFeedback={handleFeedback}
          />
        </section>

        {/* Language Selector */}
        <section className="flex justify-center">
          <LanguageSelector 
            currentLanguage={selectedLanguage}
            onLanguageChange={handleLanguageChange}
          />
        </section>

        {/* Analytics Dashboard */}
        <section>
          <StatsDashboard feedbackStats={feedbackStats} />
        </section>

        {/* Technical Details */}
        <section className="max-w-3xl mx-auto">
          <h2 className="text-xl font-bold mb-4">How It Works</h2>
          <div className="prose prose-sm dark:prose-invert">
            <div className="space-y-4 text-muted-foreground">
              <p>
                <strong className="text-foreground">1. Signal Detection:</strong> We read <code>navigator.languages</code>, 
                <code>navigator.language</code>, and <code>Intl.DateTimeFormat().resolvedOptions()</code> 
                to understand your locale preferences.
              </p>
              <p>
                <strong className="text-foreground">2. Pattern Analysis:</strong> Our TensorFlow.js model analyzes 
                patterns like timezone/language mismatches to identify user profiles (expatriates, travelers, etc.).
              </p>
              <p>
                <strong className="text-foreground">3. Prediction:</strong> Based on all signals, we predict your 
                true preferred language and recommend the optimal UI language.
              </p>
              <p>
                <strong className="text-foreground">4. Privacy:</strong> Everything runs 100% client-side. 
                No network requests, no data storage, no tracking.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>LocaleIntent Demo • Part of MyPrivacyTOOL.IO</p>
          <p className="mt-2">
            All processing happens in your browser. No data is ever sent to any server.
          </p>
        </div>
      </footer>
    </div>
  );
}
