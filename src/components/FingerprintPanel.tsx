import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Shield, AlertTriangle, Download, BarChart3, CheckCircle, XCircle, AlertCircle, Cpu, Monitor, Globe, Battery, Video } from 'lucide-react';
import {
  calculateFingerprintUniqueness,
  CompositeFingerprint,
  ProtectionStatus,
  detectWebRTCLeak,
  detectHardwareConcurrency,
  detectScreenProperties,
  detectTimezoneLocale,
  detectBatteryStatus,
  detectMediaDevices,
  WebRTCLeakResult,
  HardwareConcurrencyResult,
  ScreenPropertiesResult,
  TimezoneLocaleResult,
  BatteryStatusResult,
  MediaDevicesResult,
} from '@/lib/fingerprintDetection';
import FingerprintComparison from './FingerprintComparison';
import FingerprintVerification from './FingerprintVerification';

interface FingerprintBreakdown {
  name: string;
  uniqueness: number;
  impact: 'high' | 'medium' | 'low' | 'critical';
  icon: string;
  hash?: string;
  category: 'core' | 'advanced';
}

interface AdvancedFingerprints {
  webrtc: WebRTCLeakResult | null;
  hardware: HardwareConcurrencyResult | null;
  screen: ScreenPropertiesResult | null;
  timezone: TimezoneLocaleResult | null;
  battery: BatteryStatusResult | null;
  mediaDevices: MediaDevicesResult | null;
}

export default function FingerprintPanel() {
  const [fingerprint, setFingerprint] = useState<CompositeFingerprint | null>(null);
  const [advancedFP, setAdvancedFP] = useState<AdvancedFingerprints>({
    webrtc: null,
    hardware: null,
    screen: null,
    timezone: null,
    battery: null,
    mediaDevices: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showHardwareProfile, setShowHardwareProfile] = useState(false);
  const [showGeographic, setShowGeographic] = useState(false);
  const [uniquenessScore, setUniquenessScore] = useState(0);

  useEffect(() => {
    loadFingerprintData();
  }, []);

  // Parse uniqueness string to percentage
  const parseUniquenessToPercentage = (uniqueness: string): number => {
    const match = uniqueness.match(/1 in ([\d,]+)/);
    if (match) {
      const value = parseInt(match[1].replace(/,/g, ''), 10);
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
      // Adjust score based on advanced fingerprints
      let baseScore = parseUniquenessToPercentage(fingerprint.uniqueness);
      
      // WebRTC leak significantly increases trackability
      if (advancedFP.webrtc?.isLeaking) {
        baseScore = Math.min(baseScore + 15, 99);
      }
      
      const targetScore = baseScore;
      const duration = 1500;
      const startTime = Date.now();
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setUniquenessScore(Math.round(targetScore * eased));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      
      requestAnimationFrame(animate);
    }
  }, [fingerprint, advancedFP.webrtc?.isLeaking]);

  const loadFingerprintData = async () => {
    try {
      // Load core and advanced fingerprints in parallel
      const [coreData, webrtc, battery, mediaDevices] = await Promise.all([
        calculateFingerprintUniqueness(),
        detectWebRTCLeak().catch(() => null),
        detectBatteryStatus().catch(() => null),
        detectMediaDevices().catch(() => null),
      ]);
      
      // Synchronous detections
      const hardware = detectHardwareConcurrency();
      const screen = detectScreenProperties();
      const timezone = detectTimezoneLocale();
      
      setFingerprint(coreData);
      setAdvancedFP({
        webrtc,
        hardware,
        screen,
        timezone,
        battery,
        mediaDevices,
      });
    } catch (error) {
      console.error('Failed to calculate fingerprint:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate breakdown data including advanced methods
  const getBreakdown = (): FingerprintBreakdown[] => {
    if (!fingerprint) return [];
    
    const breakdown: FingerprintBreakdown[] = [];
    
    // Core fingerprints
    if (fingerprint.canvas) {
      breakdown.push({
        name: 'Canvas',
        uniqueness: 99.9,
        impact: 'high',
        icon: '🎨',
        hash: fingerprint.canvas.hash,
        category: 'core',
      });
    }
    
    if (fingerprint.webgl) {
      breakdown.push({
        name: 'WebGL',
        uniqueness: 95.2,
        impact: 'high',
        icon: '🎮',
        hash: fingerprint.webgl.hash,
        category: 'core',
      });
    }
    
    if (fingerprint.audio) {
      breakdown.push({
        name: 'Audio',
        uniqueness: 78.3,
        impact: 'medium',
        icon: '🔊',
        hash: fingerprint.audio.hash,
        category: 'core',
      });
    }
    
    if (fingerprint.fonts) {
      breakdown.push({
        name: 'Fonts',
        uniqueness: Math.min(45 + fingerprint.fonts.count * 0.5, 85),
        impact: 'medium',
        icon: '🔤',
        category: 'core',
      });
    }
    
    if (fingerprint.plugins) {
      breakdown.push({
        name: 'Plugins',
        uniqueness: fingerprint.plugins.adBlocker ? 35 : 23,
        impact: 'low',
        icon: '🧩',
        category: 'core',
      });
    }
    
    // Advanced fingerprints
    if (advancedFP.webrtc) {
      breakdown.push({
        name: 'WebRTC Leak',
        uniqueness: advancedFP.webrtc.isLeaking ? 100 : 5,
        impact: advancedFP.webrtc.isLeaking ? 'critical' : 'low',
        icon: '🌐',
        category: 'advanced',
      });
    }
    
    if (advancedFP.hardware) {
      breakdown.push({
        name: 'Hardware',
        uniqueness: advancedFP.hardware.hardwareClass === 'very-high' ? 45 : 
                   advancedFP.hardware.hardwareClass === 'high' ? 35 : 25,
        impact: 'low',
        icon: '🖥️',
        category: 'advanced',
      });
    }
    
    if (advancedFP.screen) {
      breakdown.push({
        name: 'Screen',
        uniqueness: advancedFP.screen.uniqueness,
        impact: advancedFP.screen.uniqueness > 60 ? 'medium' : 'low',
        icon: '📺',
        category: 'advanced',
      });
    }
    
    if (advancedFP.timezone) {
      breakdown.push({
        name: 'Timezone/Locale',
        uniqueness: advancedFP.timezone.mismatch ? 75 : 41,
        impact: advancedFP.timezone.mismatch ? 'high' : 'medium',
        icon: '🌍',
        category: 'advanced',
      });
    }
    
    if (advancedFP.battery?.available) {
      breakdown.push({
        name: 'Battery',
        uniqueness: 12.3,
        impact: 'low',
        icon: '🔋',
        category: 'advanced',
      });
    }
    
    if (advancedFP.mediaDevices && (advancedFP.mediaDevices.videoInputs > 0 || advancedFP.mediaDevices.audioInputs > 0)) {
      breakdown.push({
        name: 'Media Devices',
        uniqueness: advancedFP.mediaDevices.permissionGranted ? 45 : 28.7,
        impact: 'medium',
        icon: '🎥',
        category: 'advanced',
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
    let uniquenessFactor = Math.pow(10, 2 + (uniquenessScore / 20));
    // Increase if WebRTC is leaking
    if (advancedFP.webrtc?.isLeaking) {
      uniquenessFactor *= 10;
    }
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
      core: {
        canvas: fingerprint.canvas,
        webgl: fingerprint.webgl,
        audio: fingerprint.audio,
        fonts: fingerprint.fonts,
        plugins: fingerprint.plugins,
      },
      advanced: advancedFP,
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fingerprint-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getHardwareClassification = () => {
    if (!advancedFP.hardware || !advancedFP.screen) return 'Unknown Device';
    
    const cores = advancedFP.hardware.cores;
    const memory = advancedFP.hardware.memory;
    const pixelRatio = advancedFP.screen.pixelRatio;
    const gpu = fingerprint?.webgl?.renderer || '';
    
    if (cores >= 16 || (memory && memory >= 32)) {
      if (gpu.toLowerCase().includes('nvidia') || gpu.toLowerCase().includes('rtx')) {
        return 'High-end Gaming PC / Workstation';
      }
      return 'High-end Desktop / Workstation';
    }
    
    if (gpu.toLowerCase().includes('apple') || gpu.toLowerCase().includes('m1') || gpu.toLowerCase().includes('m2')) {
      return 'Apple Mac (M-series)';
    }
    
    if (cores >= 8 && pixelRatio >= 2) {
      return 'MacBook Pro / High-end Laptop';
    }
    
    if (cores >= 8) return 'Mid-range Desktop / Laptop';
    if (cores >= 4) return 'Standard Laptop / Desktop';
    return 'Basic / Low-power Device';
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
  const coreBreakdown = breakdown.filter(b => b.category === 'core');
  const advancedBreakdown = breakdown.filter(b => b.category === 'advanced');

  return (
    <Card className="bg-gradient-to-br from-red-950/40 to-red-900/20 border-red-500/30 overflow-hidden">
      {/* CRITICAL: WebRTC Leak Warning Banner */}
      {advancedFP.webrtc?.isLeaking && (
        <div className="bg-gradient-to-r from-red-600 to-red-700 p-4 border-b border-red-500 animate-pulse">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-white flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                ⚠️ CRITICAL: Your VPN is Leaking Your Real IP!
              </h3>
              <p className="text-red-100 text-sm mt-1">
                Even though you may be using a VPN, WebRTC is revealing your actual IP address. 
                Websites can see both your VPN IP and your real IP.
              </p>
              <div className="mt-2 p-2 bg-red-800/50 rounded-lg">
                <p className="text-red-100 text-xs font-mono">
                  <span className="text-red-300">Leaked IPs:</span> {advancedFP.webrtc.publicIPs.join(', ') || advancedFP.webrtc.localIPs.join(', ')}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white/20 hover:bg-white/30 text-white border-0"
                  onClick={() => window.open('https://browserleaks.com/webrtc', '_blank')}
                >
                  How to Fix WebRTC Leaks
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <CardHeader className="border-b border-red-500/20 pb-4">
        <CardTitle className="flex items-center gap-3 text-red-400">
          <span className="text-2xl">🔴</span>
          <div>
            <h3 className="text-lg sm:text-xl font-bold">Your Browser Fingerprint</h3>
            <p className="text-sm text-red-300/70 font-normal">12 fingerprinting methods analyzed</p>
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

        {/* Privacy Score with Advanced Metrics */}
        <div className="p-4 rounded-xl border bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-600/30">
          <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Advanced Protection Status
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.webrtc?.isLeaking ? 'bg-green-500/10' : 'bg-red-500/20'
            }`}>
              {!advancedFP.webrtc?.isLeaking ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span className="text-xs">WebRTC Protection</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              fingerprint.protection?.effectiveness === 'high' ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              {fingerprint.protection?.effectiveness === 'high' ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400/50" />
              )}
              <span className="text-xs">Hardware Anonymization</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.timezone?.mismatch ? 'bg-green-500/10' : 'bg-yellow-500/10'
            }`}>
              {!advancedFP.timezone?.mismatch ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              )}
              <span className="text-xs">Timezone Masking</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              fingerprint.protection?.brave.shieldsUp || fingerprint.protection?.firefox.resistFingerprinting 
                ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              {fingerprint.protection?.brave.shieldsUp || fingerprint.protection?.firefox.resistFingerprinting ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400/50" />
              )}
              <span className="text-xs">Canvas Protection</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.battery?.available ? 'bg-green-500/10' : 'bg-yellow-500/10'
            }`}>
              {!advancedFP.battery?.available ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              )}
              <span className="text-xs">Battery API Blocked</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.mediaDevices?.permissionGranted ? 'bg-green-500/10' : 'bg-yellow-500/10'
            }`}>
              {!advancedFP.mediaDevices?.permissionGranted ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              )}
              <span className="text-xs">Device Labels Hidden</span>
            </div>
          </div>
        </div>

        {/* Core Fingerprinting Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-red-300 flex items-center gap-2">
            <span>📊</span> Core Fingerprinting Methods
          </h4>
          <div className="space-y-2">
            {coreBreakdown.map((item) => (
              <div 
                key={item.name}
                className="flex items-center gap-3 p-3 bg-red-950/20 rounded-lg border border-red-500/10"
              >
                <span className="text-xl">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    <span className={`text-xs font-medium ${
                      item.impact === 'high' || item.impact === 'critical' ? 'text-red-400' : 
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
                  item.impact === 'high' || item.impact === 'critical' ? 'bg-red-500/20 text-red-400' : 
                  item.impact === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 
                  'bg-green-500/20 text-green-400'
                }`}>
                  {item.impact}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Advanced Fingerprinting Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-orange-300 flex items-center gap-2">
            <span>🔬</span> Advanced Fingerprinting Methods
          </h4>
          <div className="space-y-2">
            {advancedBreakdown.map((item) => (
              <div 
                key={item.name}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  item.impact === 'critical' 
                    ? 'bg-red-600/20 border-red-500/40 animate-pulse' 
                    : 'bg-orange-950/20 border-orange-500/10'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    <span className={`text-xs font-medium ${
                      item.impact === 'critical' ? 'text-red-400 font-bold' :
                      item.impact === 'high' ? 'text-red-400' : 
                      item.impact === 'medium' ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {item.impact === 'critical' ? 'CRITICAL' : `${item.uniqueness.toFixed(1)}% unique`}
                    </span>
                  </div>
                  <Progress 
                    value={item.uniqueness} 
                    className="h-1.5 bg-orange-950/50"
                  />
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  item.impact === 'critical' ? 'bg-red-600/30 text-red-300 animate-pulse' :
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

        {/* Hardware Profile Section */}
        <Collapsible open={showHardwareProfile} onOpenChange={setShowHardwareProfile}>
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className="w-full justify-between text-blue-300/70 hover:text-blue-300 hover:bg-blue-950/30"
            >
              <span className="flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                Your Hardware Profile
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showHardwareProfile ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="p-4 bg-blue-950/30 rounded-xl border border-blue-500/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Monitor className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-300">{getHardwareClassification()}</p>
                  <p className="text-xs text-blue-300/60">Estimated device classification</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2 bg-blue-950/40 rounded-lg">
                  <p className="text-blue-400 text-xs">CPU Cores</p>
                  <p className="text-blue-100 font-medium">{advancedFP.hardware?.cores || 'Unknown'}</p>
                </div>
                <div className="p-2 bg-blue-950/40 rounded-lg">
                  <p className="text-blue-400 text-xs">RAM</p>
                  <p className="text-blue-100 font-medium">{advancedFP.hardware?.memory ? `${advancedFP.hardware.memory} GB` : 'Hidden'}</p>
                </div>
                <div className="p-2 bg-blue-950/40 rounded-lg">
                  <p className="text-blue-400 text-xs">Screen</p>
                  <p className="text-blue-100 font-medium">{advancedFP.screen?.resolution} @{advancedFP.screen?.pixelRatio}x</p>
                </div>
                <div className="p-2 bg-blue-950/40 rounded-lg">
                  <p className="text-blue-400 text-xs">GPU</p>
                  <p className="text-blue-100 font-medium truncate text-xs">{fingerprint.webgl?.renderer?.substring(0, 20) || 'Hidden'}...</p>
                </div>
              </div>
              
              <p className="text-xs text-blue-200/60 mt-3 leading-relaxed">
                This combination of hardware specs reveals your device type and can be used to track you 
                even after clearing cookies. High-end devices are more unique and trackable.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Geographic Fingerprint Section */}
        <Collapsible open={showGeographic} onOpenChange={setShowGeographic}>
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className={`w-full justify-between hover:bg-purple-950/30 ${
                advancedFP.timezone?.mismatch ? 'text-yellow-400' : 'text-purple-300/70 hover:text-purple-300'
              }`}
            >
              <span className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Geographic Indicators
                {advancedFP.timezone?.mismatch && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                    Mismatch Detected
                  </span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showGeographic ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className={`p-4 rounded-xl border ${
              advancedFP.timezone?.mismatch 
                ? 'bg-yellow-950/30 border-yellow-500/30'
                : 'bg-purple-950/30 border-purple-500/20'
            }`}>
              {advancedFP.timezone?.mismatch && (
                <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-lg mb-4">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-200">
                    <strong>VPN/Travel Detected:</strong> Your timezone doesn't match your locale settings. 
                    This is a common way websites detect VPN usage.
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2 bg-purple-950/40 rounded-lg">
                  <p className="text-purple-400 text-xs">Timezone</p>
                  <p className="text-purple-100 font-medium text-xs">{advancedFP.timezone?.timezone}</p>
                </div>
                <div className="p-2 bg-purple-950/40 rounded-lg">
                  <p className="text-purple-400 text-xs">UTC Offset</p>
                  <p className="text-purple-100 font-medium">{advancedFP.timezone?.offset ? `${advancedFP.timezone.offset > 0 ? '-' : '+'}${Math.abs(advancedFP.timezone.offset / 60)}h` : 'Unknown'}</p>
                </div>
                <div className="p-2 bg-purple-950/40 rounded-lg">
                  <p className="text-purple-400 text-xs">Locale</p>
                  <p className="text-purple-100 font-medium">{navigator.language}</p>
                </div>
                <div className="p-2 bg-purple-950/40 rounded-lg">
                  <p className="text-purple-400 text-xs">Date Format</p>
                  <p className="text-purple-100 font-medium">{advancedFP.timezone?.dateFormat}</p>
                </div>
                <div className="p-2 bg-purple-950/40 rounded-lg col-span-2">
                  <p className="text-purple-400 text-xs">Number Format</p>
                  <p className="text-purple-100 font-medium">{advancedFP.timezone?.numberFormat}</p>
                </div>
              </div>
              
              <p className="text-xs text-purple-200/60 mt-3 leading-relaxed">
                Your timezone and locale settings reveal your actual location, even when using a VPN. 
                This is a common way to detect VPN usage and determine your real geographic location.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

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
              Browser Protection: {fingerprint.protection.effectiveness.charAt(0).toUpperCase() + fingerprint.protection.effectiveness.slice(1)}
              <span className="ml-auto text-xs opacity-70">Score: {fingerprint.protection.score}/100</span>
            </h4>
            
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

        {/* Enhanced Recommendations */}
        <div className="p-4 bg-gradient-to-r from-green-950/30 to-green-900/20 rounded-xl border border-green-500/20">
          <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Personalized Recommendations
          </h4>
          <ul className="space-y-2 text-sm text-green-200/80">
            {advancedFP.webrtc?.isLeaking && (
              <>
                <li className="flex items-start gap-2 text-red-300">
                  <span className="text-red-400">⚠️</span>
                  <strong>URGENT:</strong> Disable WebRTC in browser settings or use an extension like "WebRTC Leak Prevent"
                </li>
                <li className="flex items-start gap-2 text-red-300">
                  <span className="text-red-400">•</span>
                  Firefox: Set media.peerconnection.enabled to false in about:config
                </li>
              </>
            )}
            {advancedFP.timezone?.mismatch && (
              <li className="flex items-start gap-2 text-yellow-300">
                <span className="text-yellow-400">•</span>
                Use timezone spoofing extensions to match your VPN location
              </li>
            )}
            {advancedFP.screen && advancedFP.screen.uniqueness > 60 && (
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                Use browser in fullscreen to hide taskbar size (reduces screen fingerprint)
              </li>
            )}
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
              Consider Tor Browser for maximum privacy and timezone anonymization
            </li>
          </ul>
        </div>

        {/* Technical Details */}
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
              {advancedFP.webrtc && (
                <div>
                  <span className="text-red-400">WebRTC Status:</span>
                  <span className={`ml-2 ${advancedFP.webrtc.isLeaking ? 'text-red-400' : 'text-green-400'}`}>
                    {advancedFP.webrtc.isLeaking ? `LEAKING (${advancedFP.webrtc.publicIPs.join(', ')})` : 'Protected'}
                  </span>
                </div>
              )}
              {advancedFP.hardware && (
                <div>
                  <span className="text-red-400">Hardware:</span>
                  <span className="text-red-200/70 ml-2">
                    {advancedFP.hardware.cores} cores, {advancedFP.hardware.memory || 'unknown'} GB RAM
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

        {/* Comparison Section */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button 
              variant="outline" 
              className="w-full justify-between border-red-500/30 text-red-300 hover:bg-red-950/30"
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Compare With Others
              </span>
              <ChevronDown className="w-4 h-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <FingerprintComparison 
              fingerprint={fingerprint} 
              uniquenessScore={uniquenessScore} 
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Verification Section */}
        <FingerprintVerification
          currentFingerprint={fingerprint}
          currentAdvancedFP={advancedFP}
          onRetest={loadFingerprintData}
        />

        {/* Export Options */}
        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportReport}
            className="flex-1 border-red-500/30 text-red-300 hover:bg-red-950/30"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Full Report (JSON)
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