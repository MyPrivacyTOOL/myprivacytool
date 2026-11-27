import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Shield, AlertTriangle, Download, CheckCircle, XCircle, AlertCircle, Cpu, Monitor, Globe, Battery, Video } from 'lucide-react';
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
  WebRTCState,
} from '@/lib/fingerprintDetection';
import { measuredFingerprint, measuredAdvanced } from '@/lib/measuredOnly';
import FingerprintVerification from './FingerprintVerification';

// CK-8324: one line per WebRTC outcome, so a check that could not look never reads as a clean result.
const WEBRTC_READ: Record<WebRTCState, string> = {
  found: 'A public IP address was visible',
  none_found: 'No public IP address seen',
  blocked: 'Could not look (WebRTC blocked or restricted)',
  timed_out: "Check didn't finish",
  unsupported: 'Not supported by this browser',
  error: 'Check failed',
};

interface FingerprintBreakdown {
  name: string;
  /** CK-8324: what the scan read for this signal. Never a rating or an estimate. */
  read: string;
  highlight?: boolean;
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

  useEffect(() => {
    loadFingerprintData();
  }, []);

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
        read: `Hash read: ${fingerprint.canvas.hash.slice(0, 16)}`,
        icon: '🎨',
        hash: fingerprint.canvas.hash,
        category: 'core',
      });
    }
    
    if (fingerprint.webgl) {
      breakdown.push({
        name: 'WebGL',
        read: fingerprint.webgl.renderer || `Hash read: ${fingerprint.webgl.hash.slice(0, 16)}`,
        icon: '🎮',
        hash: fingerprint.webgl.hash,
        category: 'core',
      });
    }
    
    if (fingerprint.audio) {
      breakdown.push({
        name: 'Audio',
        read: `Hash read: ${fingerprint.audio.hash.slice(0, 16)}`,
        icon: '🔊',
        hash: fingerprint.audio.hash,
        category: 'core',
      });
    }
    
    if (fingerprint.fonts) {
      breakdown.push({
        name: 'Fonts',
        read: `Fonts detected: ${fingerprint.fonts.count}`,
        icon: '🔤',
        category: 'core',
      });
    }
    
    if (fingerprint.plugins) {
      breakdown.push({
        name: 'Plugins',
        read: `Plugins listed: ${fingerprint.plugins.pluginCount}. Ad blocker ${fingerprint.plugins.adBlocker ? 'detected' : 'not detected'}`,
        icon: '🧩',
        category: 'core',
      });
    }
    
    // Advanced fingerprints
    if (advancedFP.webrtc) {
      breakdown.push({
        name: 'WebRTC',
        read: WEBRTC_READ[advancedFP.webrtc.state] ?? 'Not checked',
        highlight: advancedFP.webrtc.isLeaking,
        icon: '🌐',
        category: 'advanced',
      });
    }
    
    if (advancedFP.hardware) {
      breakdown.push({
        name: 'Hardware',
        read: `CPU cores: ${advancedFP.hardware.cores}. Memory: ${advancedFP.hardware.memory ? `${advancedFP.hardware.memory} GB` : 'not reported'}`,
        icon: '🖥️',
        category: 'advanced',
      });
    }
    
    if (advancedFP.screen) {
      breakdown.push({
        name: 'Screen',
        read: `${advancedFP.screen.resolution}, ${advancedFP.screen.pixelRatio}x pixel ratio, ${advancedFP.screen.colorDepth}-bit color`,
        icon: '📺',
        category: 'advanced',
      });
    }
    
    if (advancedFP.timezone) {
      breakdown.push({
        name: 'Timezone/Locale',
        read: advancedFP.timezone.timezone,
        icon: '🌍',
        category: 'advanced',
      });
    }
    
    if (advancedFP.battery?.available) {
      breakdown.push({
        name: 'Battery',
        read: 'Battery status can be read',
        icon: '🔋',
        category: 'advanced',
      });
    }
    
    if (advancedFP.mediaDevices && (advancedFP.mediaDevices.videoInputs > 0 || advancedFP.mediaDevices.audioInputs > 0)) {
      breakdown.push({
        name: 'Media Devices',
        read: `Cameras: ${advancedFP.mediaDevices.videoInputs}. Microphones: ${advancedFP.mediaDevices.audioInputs}`,
        icon: '🎥',
        category: 'advanced',
      });
    }
    
    return breakdown;
  };

  const handleExportReport = () => {
    if (!fingerprint) return;
    
    const report = {
      timestamp: new Date().toISOString(),
      compositeHash: fingerprint.compositeHash,
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
      advanced: measuredAdvanced(advancedFP),
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
      <Card className="bg-risk-high-soft border-risk-high/30">
        <CardContent className="py-8 text-center">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-risk-high/15 flex items-center justify-center">
              <span className="text-2xl animate-spin-slow">🔴</span>
            </div>
            <p className="text-foreground">Analyzing your browser fingerprint...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!fingerprint) return null;

  const breakdown = getBreakdown();
  const coreBreakdown = breakdown.filter(b => b.category === 'core');
  const advancedBreakdown = breakdown.filter(b => b.category === 'advanced');

  return (
    <Card className="bg-risk-high-soft border-risk-high/30 overflow-hidden">
      {/* WebRTC leak notice */}
      {advancedFP.webrtc?.isLeaking && (
        <div className="bg-risk-high-soft p-4 border-b border-risk-high/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-foreground font-bold text-lg flex items-center gap-2">
                WebRTC is showing your real IP address
              </h3>
              <p className="text-foreground text-sm mt-1">
                If you use a VPN, WebRTC can still reveal your actual IP address. 
                Websites can see both your VPN IP and your real IP.
              </p>
              <div className="mt-2 p-2 bg-surface rounded-lg">
                <p className="text-foreground text-xs font-mono">
                  <span className="text-foreground">Leaked IPs:</span> {advancedFP.webrtc.publicIPs.join(', ') || advancedFP.webrtc.localIPs.join(', ')}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-surface text-foreground hover:bg-secondary border-0"
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
      <CardHeader className="border-b border-risk-high/20 pb-4">
        <CardTitle className="flex items-center gap-3 text-foreground">
          <span className="text-2xl">🔴</span>
          <div>
            <h3 className="text-lg sm:text-xl font-bold">Your Browser Fingerprint</h3>
            <p className="text-sm text-muted-foreground font-normal">Signals read from this browser: {breakdown.length}</p>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Privacy Score with Advanced Metrics */}
        <div className="p-4 rounded-xl border bg-secondary border-surface-border">
          <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Advanced Protection Status
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.webrtc?.isLeaking ? 'bg-risk-low-soft' : 'bg-risk-high/15'
            }`}>
              {!advancedFP.webrtc?.isLeaking ? (
                <CheckCircle className="w-4 h-4 text-risk-low" />
              ) : (
                <XCircle className="w-4 h-4 text-foreground" />
              )}
              <span className="text-xs">WebRTC Protection</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              fingerprint.protection?.effectiveness === 'high' ? 'bg-risk-low-soft' : 'bg-risk-high-soft'
            }`}>
              {fingerprint.protection?.effectiveness === 'high' ? (
                <CheckCircle className="w-4 h-4 text-risk-low" />
              ) : (
                <XCircle className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-xs">Hardware Anonymization</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.timezone?.mismatch ? 'bg-risk-low-soft' : 'bg-risk-mid-soft'
            }`}>
              {!advancedFP.timezone?.mismatch ? (
                <CheckCircle className="w-4 h-4 text-risk-low" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-foreground" />
              )}
              <span className="text-xs">Timezone Masking</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              fingerprint.protection?.brave.shieldsUp || fingerprint.protection?.firefox.resistFingerprinting 
                ? 'bg-risk-low-soft' : 'bg-risk-high-soft'
            }`}>
              {fingerprint.protection?.brave.shieldsUp || fingerprint.protection?.firefox.resistFingerprinting ? (
                <CheckCircle className="w-4 h-4 text-risk-low" />
              ) : (
                <XCircle className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-xs">Canvas Protection</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.battery?.available ? 'bg-risk-low-soft' : 'bg-risk-mid-soft'
            }`}>
              {!advancedFP.battery?.available ? (
                <CheckCircle className="w-4 h-4 text-risk-low" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-foreground" />
              )}
              <span className="text-xs">Battery API Blocked</span>
            </div>
            
            <div className={`flex items-center gap-2 p-2 rounded-lg ${
              !advancedFP.mediaDevices?.permissionGranted ? 'bg-risk-low-soft' : 'bg-risk-mid-soft'
            }`}>
              {!advancedFP.mediaDevices?.permissionGranted ? (
                <CheckCircle className="w-4 h-4 text-risk-low" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-foreground" />
              )}
              <span className="text-xs">Device Labels Hidden</span>
            </div>
          </div>
        </div>

        {/* Core Fingerprinting Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span>📊</span> Core Fingerprinting Methods
          </h4>
          <div className="space-y-2">
            {coreBreakdown.map((item) => (
              <div 
                key={item.name}
                className={"flex items-center gap-3 p-3 bg-risk-high-soft rounded-lg border border-risk-high/20"}
              >
                <span className="text-xl">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">{item.name}</span>
                  <span className="block text-xs text-muted-foreground break-words">{item.read}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Advanced Fingerprinting Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            Advanced Fingerprinting Methods
          </h4>
          <div className="space-y-2">
            {advancedBreakdown.map((item) => (
              <div 
                key={item.name}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  item.highlight ? 'bg-risk-high/15 border-risk-high/40' : 'bg-risk-mid-soft border-risk-mid/20'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">{item.name}</span>
                  <span className="block text-xs text-muted-foreground break-words">{item.read}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hardware Profile Section */}
        <Collapsible open={showHardwareProfile} onOpenChange={setShowHardwareProfile}>
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className="w-full justify-between text-muted-foreground hover:text-foreground hover:bg-brand-soft"
            >
              <span className="flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                Your Hardware Profile
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showHardwareProfile ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="p-4 bg-brand-soft rounded-xl border border-brand/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-lg bg-brand/15 flex items-center justify-center">
                  <Monitor className="w-6 h-6 text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-brand">{getHardwareClassification()}</p>
                  <p className="text-xs text-muted-foreground">Estimated device classification</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2 bg-brand-soft rounded-lg">
                  <p className="text-brand text-xs">CPU Cores</p>
                  <p className="text-foreground font-medium">{advancedFP.hardware?.cores || 'Unknown'}</p>
                </div>
                <div className="p-2 bg-brand-soft rounded-lg">
                  <p className="text-brand text-xs">RAM</p>
                  <p className="text-foreground font-medium">{advancedFP.hardware?.memory ? `${advancedFP.hardware.memory} GB` : 'Hidden'}</p>
                </div>
                <div className="p-2 bg-brand-soft rounded-lg">
                  <p className="text-brand text-xs">Screen</p>
                  <p className="text-foreground font-medium">{advancedFP.screen?.resolution} @{advancedFP.screen?.pixelRatio}x</p>
                </div>
                <div className="p-2 bg-brand-soft rounded-lg">
                  <p className="text-brand text-xs">GPU</p>
                  <p className="text-foreground font-medium truncate text-xs">{fingerprint.webgl?.renderer?.substring(0, 20) || 'Hidden'}...</p>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                This combination of hardware specs reveals your device type and can be used to track you 
                even after clearing cookies.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Geographic Fingerprint Section */}
        <Collapsible open={showGeographic} onOpenChange={setShowGeographic}>
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className={`w-full justify-between hover:bg-muted ${
                advancedFP.timezone?.mismatch ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Geographic Indicators
                {advancedFP.timezone?.mismatch && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-risk-mid/15 text-foreground">
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
                ? 'bg-risk-mid-soft border-risk-mid/30'
                : 'bg-muted border-border'
            }`}>
              {advancedFP.timezone?.mismatch && (
                <div className="flex items-start gap-2 p-3 bg-risk-mid-soft rounded-lg mb-4">
                  <AlertTriangle className="w-4 h-4 text-foreground flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground">
                    <strong>VPN/Travel Detected:</strong> Your timezone doesn't match your locale settings. 
                    This is a common way websites detect VPN usage.
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2 bg-muted rounded-lg">
                  <p className="text-foreground text-xs">Timezone</p>
                  <p className="text-foreground font-medium text-xs">{advancedFP.timezone?.timezone}</p>
                </div>
                <div className="p-2 bg-muted rounded-lg">
                  <p className="text-foreground text-xs">UTC Offset</p>
                  <p className="text-foreground font-medium">{advancedFP.timezone?.offset ? `${advancedFP.timezone.offset > 0 ? '-' : '+'}${Math.abs(advancedFP.timezone.offset / 60)}h` : 'Unknown'}</p>
                </div>
                <div className="p-2 bg-muted rounded-lg">
                  <p className="text-foreground text-xs">Locale</p>
                  <p className="text-foreground font-medium">{navigator.language}</p>
                </div>
                <div className="p-2 bg-muted rounded-lg">
                  <p className="text-foreground text-xs">Date Format</p>
                  <p className="text-foreground font-medium">{advancedFP.timezone?.dateFormat}</p>
                </div>
                <div className="p-2 bg-muted rounded-lg col-span-2">
                  <p className="text-foreground text-xs">Number Format</p>
                  <p className="text-foreground font-medium">{advancedFP.timezone?.numberFormat}</p>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
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
              ? 'bg-risk-low-soft border-risk-low/30' 
              : fingerprint.protection.effectiveness === 'medium'
              ? 'bg-risk-mid-soft border-risk-mid/30'
              : fingerprint.protection.effectiveness === 'low'
              ? 'bg-risk-mid-soft border-risk-mid/30'
              : 'bg-risk-high-soft border-risk-high/30'
          }`}>
            <h4 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
              fingerprint.protection.effectiveness === 'high' ? 'text-risk-low' :
              fingerprint.protection.effectiveness === 'medium' ? 'text-foreground' :
              fingerprint.protection.effectiveness === 'low' ? 'text-foreground' :
              'text-foreground'
            }`}>
              <Shield className="w-4 h-4" />
              Browser Protection: {fingerprint.protection.effectiveness.charAt(0).toUpperCase() + fingerprint.protection.effectiveness.slice(1)}
              <span className="ml-auto text-xs opacity-70">Score: {fingerprint.protection.score}/100</span>
            </h4>
            
            <p className={`text-xs leading-relaxed ${
              fingerprint.protection.effectiveness === 'high' ? 'text-foreground' :
              fingerprint.protection.effectiveness === 'medium' ? 'text-foreground' :
              fingerprint.protection.effectiveness === 'low' ? 'text-foreground' :
              'text-foreground'
            }`}>
              {fingerprint.protection.recommendation}
            </p>
          </div>
        )}

        {/* Enhanced Recommendations */}
        <div className="p-4 bg-risk-low-soft rounded-xl border border-risk-low/20">
          <h4 className="text-sm font-semibold text-risk-low mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Personalized Recommendations
          </h4>
          <ul className="space-y-2 text-sm text-foreground">
            {advancedFP.webrtc?.isLeaking && (
              <>
                <li className="flex items-start gap-2 text-foreground">
                  <span className="text-foreground">•</span>
                  <strong>Recommended:</strong> Disable WebRTC in browser settings or use an extension like "WebRTC Leak Prevent"
                </li>
                <li className="flex items-start gap-2 text-foreground">
                  <span className="text-foreground">•</span>
                  Firefox: Set media.peerconnection.enabled to false in about:config
                </li>
              </>
            )}
            {advancedFP.timezone?.mismatch && (
              <li className="flex items-start gap-2 text-foreground">
                <span className="text-foreground">•</span>
                Use timezone spoofing extensions to match your VPN location
              </li>
            )}
            {advancedFP.screen && advancedFP.screen.uniqueness > 60 && (
              <li className="flex items-start gap-2">
                <span className="text-risk-low">•</span>
                Use browser in fullscreen to hide taskbar size (reduces screen fingerprint)
              </li>
            )}
            <li className="flex items-start gap-2">
              <span className="text-risk-low">•</span>
              Use privacy-focused browsers (Brave, Firefox with privacy settings)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-risk-low">•</span>
              Enable fingerprint protection in browser settings
            </li>
            <li className="flex items-start gap-2">
              <span className="text-risk-low">•</span>
              Consider Tor Browser for maximum privacy and timezone anonymization
            </li>
          </ul>
        </div>

        {/* Technical Details */}
        <Collapsible open={showTechnical} onOpenChange={setShowTechnical}>
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className="w-full justify-between text-muted-foreground hover:text-foreground hover:bg-risk-high-soft"
            >
              <span className="flex items-center gap-2">
                <span>🔧</span>
                Technical Details
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="p-3 bg-risk-high-soft rounded-lg font-mono text-xs space-y-2 overflow-x-auto">
              {fingerprint.canvas && (
                <div>
                  <span className="text-foreground">Canvas Hash:</span>
                  <span className="text-muted-foreground ml-2 break-all">{fingerprint.canvas.hash}</span>
                </div>
              )}
              {fingerprint.webgl && (
                <>
                  <div>
                    <span className="text-foreground">WebGL Renderer:</span>
                    <span className="text-muted-foreground ml-2 break-all">{fingerprint.webgl.renderer}</span>
                  </div>
                  <div>
                    <span className="text-foreground">WebGL Vendor:</span>
                    <span className="text-muted-foreground ml-2 break-all">{fingerprint.webgl.vendor}</span>
                  </div>
                </>
              )}
              {advancedFP.webrtc && (
                <div>
                  <span className="text-foreground">WebRTC Status:</span>
                  <span className={`ml-2 ${advancedFP.webrtc.isLeaking ? 'text-foreground' : 'text-risk-low'}`}>
                    {advancedFP.webrtc.isLeaking ? `LEAKING (${advancedFP.webrtc.publicIPs.join(', ')})` : 'Protected'}
                  </span>
                </div>
              )}
              {advancedFP.hardware && (
                <div>
                  <span className="text-foreground">Hardware:</span>
                  <span className="text-muted-foreground ml-2">
                    {advancedFP.hardware.cores} cores, {advancedFP.hardware.memory || 'unknown'} GB RAM
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-risk-high/20">
                <span className="text-foreground">Composite Hash:</span>
                <span className="text-muted-foreground ml-2 break-all">{fingerprint.compositeHash}</span>
              </div>
            </div>
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
            className="flex-1 border-risk-high/30 text-foreground hover:bg-risk-high-soft"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Full Report (JSON)
          </Button>
        </div>

        {/* Privacy Reminder */}
        <div className="flex items-center gap-3 p-3 bg-risk-low-soft rounded-lg border border-risk-low/20">
          <span className="text-xl">🔒</span>
          <p className="text-xs text-risk-low">
            <strong>Privacy Protected:</strong> All data shown is local to your device only. 
            No fingerprint data is sent to any server.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}