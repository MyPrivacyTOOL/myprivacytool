import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Shield, AlertTriangle, Download, Share2, CheckCircle, XCircle } from 'lucide-react';
import {
  calculateFingerprintUniqueness,
  CompositeFingerprint,
  ProtectionStatus,
} from '@/lib/fingerprintDetection';

interface FingerprintBreakdown {
  name: string;
  uniqueness: number;
  impact: 'high' | 'medium' | 'low';
  icon: string;
  hash?: string;
}

export default function FingerprintPanel() {
  const [fingerprint, setFingerprint] = useState<CompositeFingerprint | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showTechnical, setShowTechnical] = useState(false);
  const [uniquenessScore, setUniquenessScore] = useState(0);

  useEffect(() => {
    loadFingerprintData();
  }, []);

  // Parse uniqueness string to percentage
  const parseUniquenessToPercentage = (uniqueness: string): number => {
    // Parse "1 in X" format
    const match = uniqueness.match(/1 in ([\d,]+)/);
    if (match) {
      const value = parseInt(match[1].replace(/,/g, ''), 10);
      // Convert to percentage (higher number = more unique)
      if (value < 1000) return 30;
      if (value < 10000) return 50;
      if (value < 100000) return 70;
      if (value < 1000000) return 85;
      return 95;
    }
    return 50;
  };

  // Animate uniqueness score
  useEffect(() => {
    if (fingerprint) {
      const targetScore = parseUniquenessToPercentage(fingerprint.uniqueness);
      const duration = 1500;
      const startTime = Date.now();
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        setUniquenessScore(Math.round(targetScore * eased));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      
      requestAnimationFrame(animate);
    }
  }, [fingerprint]);

  const loadFingerprintData = async () => {
    try {
      const data = await calculateFingerprintUniqueness();
      setFingerprint(data);
    } catch (error) {
      console.error('Failed to calculate fingerprint:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate breakdown data
  const getBreakdown = (): FingerprintBreakdown[] => {
    if (!fingerprint) return [];
    
    const breakdown: FingerprintBreakdown[] = [];
    
    if (fingerprint.canvas) {
      breakdown.push({
        name: 'Canvas',
        uniqueness: 99.9,
        impact: 'high',
        icon: '🎨',
        hash: fingerprint.canvas.hash,
      });
    }
    
    if (fingerprint.webgl) {
      breakdown.push({
        name: 'WebGL',
        uniqueness: 95.2,
        impact: 'high',
        icon: '🎮',
        hash: fingerprint.webgl.hash,
      });
    }
    
    if (fingerprint.audio) {
      breakdown.push({
        name: 'Audio',
        uniqueness: 78.3,
        impact: 'medium',
        icon: '🔊',
        hash: fingerprint.audio.hash,
      });
    }
    
    if (fingerprint.fonts) {
      breakdown.push({
        name: 'Fonts',
        uniqueness: Math.min(45 + fingerprint.fonts.count * 0.5, 85),
        impact: 'medium',
        icon: '🔤',
      });
    }
    
    if (fingerprint.plugins) {
      breakdown.push({
        name: 'Plugins',
        uniqueness: fingerprint.plugins.adBlocker ? 35 : 23,
        impact: 'low',
        icon: '🧩',
      });
    }
    
    return breakdown;
  };

  const getUniquenessColor = (percentage: number) => {
    if (percentage < 50) return 'text-green-400';
    if (percentage < 80) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getUniquenessLabel = (percentage: number) => {
    if (percentage < 50) return { level: 'Common', risk: 'low', color: 'bg-green-500' };
    if (percentage < 80) return { level: 'Somewhat Unique', risk: 'medium', color: 'bg-yellow-500' };
    return { level: 'Very Unique', risk: 'high', color: 'bg-red-500' };
  };

  const getEstimatedUniqueness = () => {
    if (!fingerprint) return '1 in unknown';
    const uniquenessFactor = Math.pow(10, 2 + (uniquenessScore / 20));
    return `1 in ${Math.round(uniquenessFactor).toLocaleString()}`;
  };

  const handleExportReport = () => {
    if (!fingerprint) return;
    
    const report = {
      timestamp: new Date().toISOString(),
      compositeHash: fingerprint.compositeHash,
      uniqueness: fingerprint.uniqueness,
      totalRisk: fingerprint.totalRisk,
      breakdown: getBreakdown().map(b => ({
        ...b,
        hash: b.hash || 'N/A',
      })),
      canvas: fingerprint.canvas,
      webgl: fingerprint.webgl,
      audio: fingerprint.audio,
      fonts: fingerprint.fonts,
      plugins: fingerprint.plugins,
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fingerprint-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-red-950/40 to-red-900/20 border-red-500/30">
        <CardContent className="py-8 text-center">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-2xl animate-spin-slow">🔴</span>
            </div>
            <p className="text-red-300">Analyzing your browser fingerprint...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!fingerprint) return null;

  const uniquenessInfo = getUniquenessLabel(uniquenessScore);
  const breakdown = getBreakdown();

  return (
    <Card className="bg-gradient-to-br from-red-950/40 to-red-900/20 border-red-500/30 overflow-hidden">
      {/* Header */}
      <CardHeader className="border-b border-red-500/20 pb-4">
        <CardTitle className="flex items-center gap-3 text-red-400">
          <span className="text-2xl">🔴</span>
          <div>
            <h3 className="text-lg sm:text-xl font-bold">Your Browser Fingerprint</h3>
            <p className="text-sm text-red-300/70 font-normal">How unique and trackable are you?</p>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Uniqueness Score */}
        <div className="text-center py-4 bg-red-950/30 rounded-xl border border-red-500/20">
          <p className="text-red-300/70 text-sm mb-2">Your browser is</p>
          <p className={`text-3xl sm:text-4xl font-bold ${getUniquenessColor(uniquenessScore)}`}>
            {getEstimatedUniqueness()}
          </p>
          <div className="mt-4 px-4">
            <div className="flex items-center justify-between text-xs text-red-300/60 mb-1">
              <span>Common</span>
              <span>Unique</span>
            </div>
            <div className="relative h-3 bg-red-950/50 rounded-full overflow-hidden">
              <div 
                className={`absolute inset-y-0 left-0 ${uniquenessInfo.color} transition-all duration-1000 rounded-full`}
                style={{ width: `${uniquenessScore}%` }}
              />
            </div>
          </div>
          <p className={`mt-3 text-sm font-medium ${getUniquenessColor(uniquenessScore)}`}>
            {uniquenessInfo.level} ({uniquenessScore}% unique)
          </p>
        </div>

        {/* Protection Status */}
        {fingerprint.protection && (
          <div className={`p-4 rounded-xl border ${
            fingerprint.protection.effectiveness === 'high' 
              ? 'bg-green-950/30 border-green-500/30' 
              : fingerprint.protection.effectiveness === 'medium'
              ? 'bg-yellow-950/30 border-yellow-500/30'
              : fingerprint.protection.effectiveness === 'low'
              ? 'bg-orange-950/30 border-orange-500/30'
              : 'bg-red-950/30 border-red-500/30'
          }`}>
            <h4 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
              fingerprint.protection.effectiveness === 'high' ? 'text-green-400' :
              fingerprint.protection.effectiveness === 'medium' ? 'text-yellow-400' :
              fingerprint.protection.effectiveness === 'low' ? 'text-orange-400' :
              'text-red-400'
            }`}>
              <Shield className="w-4 h-4" />
              Protection Status: {fingerprint.protection.effectiveness.charAt(0).toUpperCase() + fingerprint.protection.effectiveness.slice(1)}
              <span className="ml-auto text-xs opacity-70">Score: {fingerprint.protection.score}/100</span>
            </h4>
            
            {/* Protection Indicators */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className={`flex items-center gap-2 p-2 rounded-lg ${
                fingerprint.protection.brave.isBrave ? 'bg-green-500/10' : 'bg-red-500/5'
              }`}>
                {fingerprint.protection.brave.isBrave ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400/50" />
                )}
                <span className="text-xs">
                  {fingerprint.protection.brave.isBrave 
                    ? `Brave${fingerprint.protection.brave.shieldsUp ? ' Shields' : ''}` 
                    : 'No Brave'}
                </span>
              </div>
              
              <div className={`flex items-center gap-2 p-2 rounded-lg ${
                fingerprint.protection.firefox.resistFingerprinting ? 'bg-green-500/10' : 'bg-red-500/5'
              }`}>
                {fingerprint.protection.firefox.resistFingerprinting ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400/50" />
                )}
                <span className="text-xs">
                  {fingerprint.protection.firefox.resistFingerprinting 
                    ? 'Firefox RFP' 
                    : fingerprint.protection.firefox.isFirefox 
                      ? 'Firefox (basic)'
                      : 'No Firefox RFP'}
                </span>
              </div>
              
              <div className={`flex items-center gap-2 p-2 rounded-lg ${
                fingerprint.protection.tor.isTor ? 'bg-green-500/10' : 'bg-red-500/5'
              }`}>
                {fingerprint.protection.tor.isTor ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400/50" />
                )}
                <span className="text-xs">
                  {fingerprint.protection.tor.isTor 
                    ? `Tor (${fingerprint.protection.tor.protectionLevel})` 
                    : 'No Tor'}
                </span>
              </div>
              
              <div className={`flex items-center gap-2 p-2 rounded-lg ${
                fingerprint.protection.extensions.blocking ? 'bg-green-500/10' : 'bg-red-500/5'
              }`}>
                {fingerprint.protection.extensions.blocking ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400/50" />
                )}
                <span className="text-xs">
                  {fingerprint.protection.extensions.blocking 
                    ? `${fingerprint.protection.extensions.extensions.length} extension${fingerprint.protection.extensions.extensions.length !== 1 ? 's' : ''}` 
                    : 'No extensions'}
                </span>
              </div>
            </div>
            
            {/* Recommendation */}
            <p className={`text-xs leading-relaxed ${
              fingerprint.protection.effectiveness === 'high' ? 'text-green-200/80' :
              fingerprint.protection.effectiveness === 'medium' ? 'text-yellow-200/80' :
              fingerprint.protection.effectiveness === 'low' ? 'text-orange-200/80' :
              'text-red-200/80'
            }`}>
              {fingerprint.protection.recommendation}
            </p>
          </div>
        )}

        {/* Fingerprint Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-red-300 flex items-center gap-2">
            <span>📊</span> Fingerprint Breakdown
          </h4>
          <div className="space-y-2">
            {breakdown.map((item) => (
              <div 
                key={item.name}
                className="flex items-center gap-3 p-3 bg-red-950/20 rounded-lg border border-red-500/10"
              >
                <span className="text-xl">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    <span className={`text-xs font-medium ${
                      item.impact === 'high' ? 'text-red-400' : 
                      item.impact === 'medium' ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {item.uniqueness.toFixed(1)}% unique
                    </span>
                  </div>
                  <Progress 
                    value={item.uniqueness} 
                    className="h-1.5 bg-red-950/50"
                  />
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  item.impact === 'high' ? 'bg-red-500/20 text-red-400' : 
                  item.impact === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 
                  'bg-green-500/20 text-green-400'
                }`}>
                  {item.impact}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* What This Means */}
        <div className="p-4 bg-red-950/30 rounded-xl border border-red-500/20">
          <h4 className="text-sm font-semibold text-red-300 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            What This Means
          </h4>
          <p className="text-sm text-red-200/80 leading-relaxed">
            Browser fingerprinting allows websites to track you without cookies—even in 
            incognito mode or after clearing browsing data. Your unique combination of 
            browser characteristics creates a "fingerprint" that can identify you across 
            the web.
          </p>
        </div>

        {/* Privacy Impact */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={`p-3 rounded-lg border ${
            fingerprint.totalRisk === 'high' 
              ? 'bg-red-500/10 border-red-500/30' 
              : 'bg-red-950/20 border-red-500/10'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span>🔴</span>
              <span className="text-xs font-medium text-red-400">High Risk</span>
            </div>
            <p className="text-xs text-red-200/70">Trackable across websites</p>
          </div>
          <div className={`p-3 rounded-lg border ${
            fingerprint.totalRisk === 'medium' 
              ? 'bg-yellow-500/10 border-yellow-500/30' 
              : 'bg-red-950/20 border-red-500/10'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span>🟡</span>
              <span className="text-xs font-medium text-yellow-400">Medium Risk</span>
            </div>
            <p className="text-xs text-yellow-200/70">Somewhat trackable</p>
          </div>
          <div className={`p-3 rounded-lg border ${
            fingerprint.totalRisk === 'low' 
              ? 'bg-green-500/10 border-green-500/30' 
              : 'bg-red-950/20 border-red-500/10'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span>🟢</span>
              <span className="text-xs font-medium text-green-400">Low Risk</span>
            </div>
            <p className="text-xs text-green-200/70">Hard to track</p>
          </div>
        </div>

        {/* Protection Recommendations */}
        <div className="p-4 bg-gradient-to-r from-green-950/30 to-green-900/20 rounded-xl border border-green-500/20">
          <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Protection Recommendations
          </h4>
          <ul className="space-y-2 text-sm text-green-200/80">
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              Use privacy-focused browsers (Brave, Firefox with privacy settings)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              Enable fingerprint protection in browser settings
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              Use browser extensions (uBlock Origin, Privacy Badger)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              Regularly clear browser data and cookies
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              Consider Tor Browser for maximum privacy
            </li>
          </ul>
        </div>

        {/* Technical Details (Expandable) */}
        <Collapsible open={showTechnical} onOpenChange={setShowTechnical}>
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className="w-full justify-between text-red-300/70 hover:text-red-300 hover:bg-red-950/30"
            >
              <span className="flex items-center gap-2">
                <span>🔧</span>
                Technical Details
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="p-3 bg-red-950/30 rounded-lg font-mono text-xs space-y-2 overflow-x-auto">
              {fingerprint.canvas && (
                <div>
                  <span className="text-red-400">Canvas Hash:</span>
                  <span className="text-red-200/70 ml-2 break-all">{fingerprint.canvas.hash}</span>
                </div>
              )}
              {fingerprint.webgl && (
                <>
                  <div>
                    <span className="text-red-400">WebGL Renderer:</span>
                    <span className="text-red-200/70 ml-2 break-all">{fingerprint.webgl.renderer}</span>
                  </div>
                  <div>
                    <span className="text-red-400">WebGL Vendor:</span>
                    <span className="text-red-200/70 ml-2 break-all">{fingerprint.webgl.vendor}</span>
                  </div>
                </>
              )}
              {fingerprint.audio && (
                <div>
                  <span className="text-red-400">Audio Hash:</span>
                  <span className="text-red-200/70 ml-2 break-all">{fingerprint.audio.hash}</span>
                </div>
              )}
              {fingerprint.fonts && (
                <div>
                  <span className="text-red-400">Fonts Detected:</span>
                  <span className="text-red-200/70 ml-2">{fingerprint.fonts.count} fonts</span>
                  <div className="mt-1 text-red-200/50">
                    {fingerprint.fonts.uniqueFonts.slice(0, 10).join(', ')}
                    {fingerprint.fonts.uniqueFonts.length > 10 && '...'}
                  </div>
                </div>
              )}
              {fingerprint.plugins && (
                <div>
                  <span className="text-red-400">Plugins:</span>
                  <span className="text-red-200/70 ml-2">
                    {fingerprint.plugins.pluginCount} plugins, Ad Blocker: {fingerprint.plugins.adBlocker ? 'Yes' : 'No'}
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-red-500/20">
                <span className="text-red-400">Composite Hash:</span>
                <span className="text-red-200/70 ml-2 break-all">{fingerprint.compositeHash}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Export Options */}
        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportReport}
            className="flex-1 sm:flex-none border-red-500/30 text-red-300 hover:bg-red-950/30"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Report (JSON)
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            disabled
            className="flex-1 sm:flex-none border-red-500/30 text-red-300/50"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Compare With Others
          </Button>
        </div>

        {/* Privacy Reminder */}
        <div className="flex items-center gap-3 p-3 bg-green-950/30 rounded-lg border border-green-500/20">
          <span className="text-xl">🔒</span>
          <p className="text-xs text-green-300/80">
            <strong>Privacy Protected:</strong> All data shown is local to your device only. 
            No fingerprint data is sent to any server.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
