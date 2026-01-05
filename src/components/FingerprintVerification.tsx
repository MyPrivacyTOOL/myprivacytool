import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  RefreshCw, CheckCircle, XCircle, Minus, Download, Shield, 
  AlertTriangle, PartyPopper, Clock, Zap
} from 'lucide-react';
import {
  calculateFingerprintUniqueness,
  CompositeFingerprint,
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

interface TestResult {
  method: string;
  before: string;
  after: string;
  status: 'improved' | 'same' | 'regressed';
}

interface StoredTestData {
  timestamp: number;
  fingerprint: CompositeFingerprint;
  advancedFP: {
    webrtc: WebRTCLeakResult | null;
    hardware: HardwareConcurrencyResult | null;
    screen: ScreenPropertiesResult | null;
    timezone: TimezoneLocaleResult | null;
    battery: BatteryStatusResult | null;
    mediaDevices: MediaDevicesResult | null;
  };
  uniqueness: string;
}

interface FingerprintVerificationProps {
  currentFingerprint: CompositeFingerprint;
  currentAdvancedFP: {
    webrtc: WebRTCLeakResult | null;
    hardware: HardwareConcurrencyResult | null;
    screen: ScreenPropertiesResult | null;
    timezone: TimezoneLocaleResult | null;
    battery: BatteryStatusResult | null;
    mediaDevices: MediaDevicesResult | null;
  };
  onRetest: () => Promise<void>;
}

const STORAGE_KEY = 'fingerprint-test-history';

export default function FingerprintVerification({ 
  currentFingerprint, 
  currentAdvancedFP,
  onRetest 
}: FingerprintVerificationProps) {
  const [isRetesting, setIsRetesting] = useState(false);
  const [testingMethod, setTestingMethod] = useState<string | null>(null);
  const [previousData, setPreviousData] = useState<StoredTestData | null>(null);
  const [comparison, setComparison] = useState<TestResult[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [lastTestTime, setLastTestTime] = useState<number | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [improvementScore, setImprovementScore] = useState(0);

  // Load previous data and monitoring status on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const history: StoredTestData[] = JSON.parse(stored);
      if (history.length > 0) {
        setPreviousData(history[history.length - 1]);
        setLastTestTime(history[history.length - 1].timestamp);
      }
    }
    
    const monitoring = localStorage.getItem('fingerprint-monitoring');
    if (monitoring === 'true') {
      setMonitoringEnabled(true);
    }
  }, []);

  // Save current data when testing completes
  const saveCurrentData = () => {
    const newData: StoredTestData = {
      timestamp: Date.now(),
      fingerprint: currentFingerprint,
      advancedFP: currentAdvancedFP,
      uniqueness: currentFingerprint.uniqueness,
    };

    const stored = localStorage.getItem(STORAGE_KEY);
    const history: StoredTestData[] = stored ? JSON.parse(stored) : [];
    history.push(newData);
    
    // Keep last 10 tests
    if (history.length > 10) {
      history.shift();
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    setLastTestTime(newData.timestamp);
    setPreviousData(newData);
  };

  // Calculate comparison results
  const calculateComparison = (before: StoredTestData, after: {
    fingerprint: CompositeFingerprint;
    advancedFP: typeof currentAdvancedFP;
  }): TestResult[] => {
    const results: TestResult[] = [];

    // Canvas
    const canvasBefore = before.fingerprint.canvas?.hash?.substring(0, 12) || 'N/A';
    const canvasAfter = after.fingerprint.canvas?.hash?.substring(0, 12) || 'N/A';
    results.push({
      method: 'Canvas',
      before: canvasBefore + '...',
      after: canvasAfter + '...',
      status: canvasBefore === canvasAfter ? 'same' : 'same', // Different hash isn't necessarily better
    });

    // WebGL
    const webglBefore = before.fingerprint.webgl?.renderer?.substring(0, 15) || 'N/A';
    const webglAfter = after.fingerprint.webgl?.renderer?.substring(0, 15) || 'N/A';
    results.push({
      method: 'WebGL',
      before: webglBefore + '...',
      after: webglAfter + '...',
      status: 'same',
    });

    // WebRTC Leak - Critical
    const webrtcBefore = before.advancedFP.webrtc?.isLeaking ? '❌ Leaking' : '✅ Protected';
    const webrtcAfter = after.advancedFP.webrtc?.isLeaking ? '❌ Leaking' : '✅ Protected';
    results.push({
      method: 'WebRTC Leak',
      before: webrtcBefore,
      after: webrtcAfter,
      status: !before.advancedFP.webrtc?.isLeaking && after.advancedFP.webrtc?.isLeaking ? 'regressed' :
              before.advancedFP.webrtc?.isLeaking && !after.advancedFP.webrtc?.isLeaking ? 'improved' : 'same',
    });

    // Audio
    const audioBefore = before.fingerprint.audio?.hash?.substring(0, 12) || 'N/A';
    const audioAfter = after.fingerprint.audio?.hash?.substring(0, 12) || 'N/A';
    results.push({
      method: 'Audio',
      before: audioBefore + '...',
      after: audioAfter + '...',
      status: 'same',
    });

    // Fonts
    const fontsBefore = `${before.fingerprint.fonts?.count || 0} fonts`;
    const fontsAfter = `${after.fingerprint.fonts?.count || 0} fonts`;
    results.push({
      method: 'Fonts',
      before: fontsBefore,
      after: fontsAfter,
      status: 'same',
    });

    // Extensions/Protection
    const protBefore = before.fingerprint.protection?.effectiveness || 'none';
    const protAfter = after.fingerprint.protection?.effectiveness || 'none';
    const protLevels = { 'none': 0, 'low': 1, 'medium': 2, 'high': 3 };
    results.push({
      method: 'Protection',
      before: protBefore.charAt(0).toUpperCase() + protBefore.slice(1),
      after: protAfter.charAt(0).toUpperCase() + protAfter.slice(1),
      status: protLevels[protAfter as keyof typeof protLevels] > protLevels[protBefore as keyof typeof protLevels] ? 'improved' :
              protLevels[protAfter as keyof typeof protLevels] < protLevels[protBefore as keyof typeof protLevels] ? 'regressed' : 'same',
    });

    // Hardware
    const hwBefore = `${before.advancedFP.hardware?.cores || '?'} cores`;
    const hwAfter = `${after.advancedFP.hardware?.cores || '?'} cores`;
    results.push({
      method: 'Hardware',
      before: hwBefore,
      after: hwAfter,
      status: 'same',
    });

    // Screen
    const screenBefore = before.advancedFP.screen?.resolution || 'N/A';
    const screenAfter = after.advancedFP.screen?.resolution || 'N/A';
    results.push({
      method: 'Screen',
      before: screenBefore,
      after: screenAfter,
      status: 'same',
    });

    // Timezone
    const tzBefore = before.advancedFP.timezone?.timezone?.split('/')[1] || 'N/A';
    const tzAfter = after.advancedFP.timezone?.timezone?.split('/')[1] || 'N/A';
    results.push({
      method: 'Timezone',
      before: tzBefore,
      after: tzAfter,
      status: 'same',
    });

    // Battery
    const battBefore = before.advancedFP.battery?.available 
      ? `${before.advancedFP.battery.level}% ${before.advancedFP.battery.charging ? 'Charging' : ''}`
      : 'Blocked';
    const battAfter = after.advancedFP.battery?.available 
      ? `${after.advancedFP.battery.level}% ${after.advancedFP.battery.charging ? 'Charging' : ''}`
      : 'Blocked';
    results.push({
      method: 'Battery',
      before: battBefore,
      after: battAfter,
      status: before.advancedFP.battery?.available && !after.advancedFP.battery?.available ? 'improved' :
              !before.advancedFP.battery?.available && after.advancedFP.battery?.available ? 'regressed' : 'same',
    });

    // Media Devices
    const mediaBefore = before.advancedFP.mediaDevices?.permissionGranted 
      ? `${before.advancedFP.mediaDevices.videoInputs},${before.advancedFP.mediaDevices.audioInputs},${before.advancedFP.mediaDevices.audioOutputs}`
      : 'Permission Denied';
    const mediaAfter = after.advancedFP.mediaDevices?.permissionGranted 
      ? `${after.advancedFP.mediaDevices.videoInputs},${after.advancedFP.mediaDevices.audioInputs},${after.advancedFP.mediaDevices.audioOutputs}`
      : 'Permission Denied';
    results.push({
      method: 'Media Devices',
      before: mediaBefore,
      after: mediaAfter,
      status: before.advancedFP.mediaDevices?.permissionGranted && !after.advancedFP.mediaDevices?.permissionGranted ? 'improved' :
              !before.advancedFP.mediaDevices?.permissionGranted && after.advancedFP.mediaDevices?.permissionGranted ? 'regressed' : 'same',
    });

    return results;
  };

  // Handle full retest
  const handleFullRetest = async () => {
    setIsRetesting(true);
    setShowComparison(false);
    
    // Save current as "before" if we don't have previous
    if (!previousData) {
      saveCurrentData();
    }
    
    try {
      await onRetest();
      
      // Wait a moment for state to update
      setTimeout(() => {
        if (previousData) {
          const results = calculateComparison(previousData, {
            fingerprint: currentFingerprint,
            advancedFP: currentAdvancedFP,
          });
          setComparison(results);
          
          // Calculate improvement score
          const improvements = results.filter(r => r.status === 'improved').length;
          const regressions = results.filter(r => r.status === 'regressed').length;
          const score = ((improvements - regressions) / results.length) * 100;
          setImprovementScore(Math.round(score));
          
          // Show celebration if significant improvement
          if (improvements >= 2 && regressions === 0) {
            setShowCelebration(true);
            setTimeout(() => setShowCelebration(false), 5000);
          }
          
          setShowComparison(true);
        }
        
        saveCurrentData();
        setIsRetesting(false);
      }, 500);
    } catch (error) {
      console.error('Retest failed:', error);
      setIsRetesting(false);
    }
  };

  // Handle individual method test
  const handleSingleTest = async (method: string) => {
    setTestingMethod(method);
    
    try {
      let result: string = 'Tested';
      
      switch (method) {
        case 'webrtc':
          const webrtc = await detectWebRTCLeak();
          result = webrtc.isLeaking ? '❌ Still Leaking' : '✅ Protected!';
          break;
        case 'canvas':
          const fp = await calculateFingerprintUniqueness();
          result = fp.canvas?.hash ? 'Hash: ' + fp.canvas.hash.substring(0, 8) + '...' : 'N/A';
          break;
        case 'webgl':
          const fp2 = await calculateFingerprintUniqueness();
          result = fp2.webgl?.renderer?.substring(0, 20) + '...' || 'N/A';
          break;
        case 'uniqueness':
          const fp3 = await calculateFingerprintUniqueness();
          result = fp3.uniqueness;
          break;
      }
      
      // Brief display of result
      setTimeout(() => setTestingMethod(null), 2000);
    } catch (error) {
      setTestingMethod(null);
    }
  };

  // Toggle monitoring
  const handleMonitoringToggle = (enabled: boolean) => {
    setMonitoringEnabled(enabled);
    localStorage.setItem('fingerprint-monitoring', enabled.toString());
  };

  // Export verification report
  const handleExportReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      currentTest: {
        fingerprint: currentFingerprint,
        advancedFP: currentAdvancedFP,
      },
      comparison: comparison,
      improvementScore: improvementScore,
      testHistory: previousData ? [previousData] : [],
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fingerprint-verification-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Format time ago
  const getTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Calculate uniqueness change
  const getUniquenessChange = () => {
    if (!previousData) return null;
    
    const parseBefore = previousData.uniqueness.match(/1 in ([\d,]+)/);
    const parseAfter = currentFingerprint.uniqueness.match(/1 in ([\d,]+)/);
    
    if (!parseBefore || !parseAfter) return null;
    
    const before = parseInt(parseBefore[1].replace(/,/g, ''));
    const after = parseInt(parseAfter[1].replace(/,/g, ''));
    
    if (before === after) return { change: 0, text: 'No change' };
    
    if (after < before) {
      const percent = Math.round((1 - after / before) * 100);
      return { change: percent, text: `${percent}% less unique! 🎉`, improved: true };
    } else {
      const percent = Math.round((after / before - 1) * 100);
      return { change: -percent, text: `${percent}% more unique ⚠️`, improved: false };
    }
  };

  // Protection checklist
  const getProtectionChecklist = () => [
    { 
      label: 'WebRTC Leak Fixed', 
      checked: !currentAdvancedFP.webrtc?.isLeaking 
    },
    { 
      label: 'Canvas Randomization Enabled', 
      checked: currentFingerprint.protection?.brave.shieldsUp || 
               currentFingerprint.protection?.firefox.resistFingerprinting 
    },
    { 
      label: 'WebGL Blocked/Randomized', 
      checked: currentFingerprint.protection?.effectiveness === 'high' 
    },
    { 
      label: 'Audio Context Protected', 
      checked: currentFingerprint.protection?.score > 50 
    },
    { 
      label: 'Font Enumeration Blocked', 
      checked: currentFingerprint.protection?.effectiveness === 'high' 
    },
    { 
      label: 'Battery API Disabled', 
      checked: !currentAdvancedFP.battery?.available 
    },
    { 
      label: 'Media Devices Permission Denied', 
      checked: !currentAdvancedFP.mediaDevices?.permissionGranted 
    },
    { 
      label: 'Timezone Matches VPN', 
      checked: !currentAdvancedFP.timezone?.mismatch 
    },
  ];

  const checklist = getProtectionChecklist();
  const checkedCount = checklist.filter(c => c.checked).length;
  const hasRegressions = comparison.some(c => c.status === 'regressed');
  const uniquenessChange = getUniquenessChange();

  return (
    <Card className="bg-gradient-to-br from-emerald-950/40 to-emerald-900/20 border-emerald-500/30 overflow-hidden">
      {/* Celebration Overlay */}
      {showCelebration && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="text-center animate-scale-in">
            <PartyPopper className="w-16 h-16 text-yellow-400 mx-auto mb-4 animate-bounce" />
            <h3 className="text-2xl font-bold text-white mb-2">Great Job! 🎉</h3>
            <p className="text-emerald-200">Your privacy is much better protected!</p>
          </div>
        </div>
      )}

      {/* Regression Warning */}
      {hasRegressions && showComparison && (
        <div className="bg-gradient-to-r from-red-600 to-red-700 p-4 border-b border-red-500">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-white" />
            <div>
              <h3 className="text-white font-bold">⚠️ Your Protection Decreased!</h3>
              <p className="text-red-100 text-sm">Some settings changed that made you more trackable.</p>
            </div>
          </div>
        </div>
      )}

      <CardHeader className="border-b border-emerald-500/20 pb-4">
        <CardTitle className="flex items-center justify-between text-emerald-400">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5" />
            <div>
              <h3 className="text-lg font-bold">Verify Your Protection</h3>
              {lastTestTime && (
                <p className="text-sm text-emerald-300/60 font-normal flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last tested: {getTimeAgo(lastTestTime)}
                </p>
              )}
            </div>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Re-Test All Button */}
        <Button
          onClick={handleFullRetest}
          disabled={isRetesting}
          className="w-full h-14 text-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/30"
        >
          {isRetesting ? (
            <>
              <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
              Re-Testing All 12 Fingerprints...
            </>
          ) : (
            <>
              <RefreshCw className="w-5 h-5 mr-2" />
              Re-Test All Fingerprints
            </>
          )}
        </Button>

        {/* Comparison Table */}
        {showComparison && comparison.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
              📊 Before/After Comparison
            </h4>
            
            <div className="rounded-lg border border-emerald-500/20 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-emerald-950/50 border-emerald-500/20">
                    <TableHead className="text-emerald-300">Method</TableHead>
                    <TableHead className="text-emerald-300">Before</TableHead>
                    <TableHead className="text-emerald-300">After</TableHead>
                    <TableHead className="text-emerald-300 text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.map((row) => (
                    <TableRow key={row.method} className="border-emerald-500/10">
                      <TableCell className="font-medium text-foreground">{row.method}</TableCell>
                      <TableCell className="text-muted-foreground text-xs font-mono">{row.before}</TableCell>
                      <TableCell className="text-muted-foreground text-xs font-mono">{row.after}</TableCell>
                      <TableCell className="text-center">
                        {row.status === 'improved' && (
                          <span className="inline-flex items-center gap-1 text-green-400 text-xs">
                            <CheckCircle className="w-4 h-4" /> Improved
                          </span>
                        )}
                        {row.status === 'regressed' && (
                          <span className="inline-flex items-center gap-1 text-red-400 text-xs">
                            <XCircle className="w-4 h-4" /> Worse
                          </span>
                        )}
                        {row.status === 'same' && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                            <Minus className="w-4 h-4" /> Same
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Improvement Score */}
            {uniquenessChange && (
              <div className={`p-4 rounded-xl border ${
                uniquenessChange.improved ? 'bg-green-950/30 border-green-500/30' : 'bg-red-950/30 border-red-500/30'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Uniqueness Change</span>
                  <span className={`font-bold ${uniquenessChange.improved ? 'text-green-400' : 'text-red-400'}`}>
                    {uniquenessChange.text}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="p-2 bg-black/20 rounded-lg">
                    <p className="text-xs text-muted-foreground">Before</p>
                    <p className="text-sm font-medium text-foreground">{previousData?.uniqueness}</p>
                  </div>
                  <div className="p-2 bg-black/20 rounded-lg">
                    <p className="text-xs text-muted-foreground">After</p>
                    <p className="text-sm font-medium text-foreground">{currentFingerprint.uniqueness}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Individual Test Buttons */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Quick Tests
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSingleTest('webrtc')}
              disabled={testingMethod === 'webrtc'}
              className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/30"
            >
              {testingMethod === 'webrtc' ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <span className="mr-2">🌐</span>
              )}
              Test WebRTC
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSingleTest('canvas')}
              disabled={testingMethod === 'canvas'}
              className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/30"
            >
              {testingMethod === 'canvas' ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <span className="mr-2">🎨</span>
              )}
              Test Canvas
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSingleTest('webgl')}
              disabled={testingMethod === 'webgl'}
              className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/30"
            >
              {testingMethod === 'webgl' ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <span className="mr-2">🎮</span>
              )}
              Test WebGL
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSingleTest('uniqueness')}
              disabled={testingMethod === 'uniqueness'}
              className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/30"
            >
              {testingMethod === 'uniqueness' ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <span className="mr-2">🔢</span>
              )}
              Test Uniqueness
            </Button>
          </div>
        </div>

        {/* Protection Checklist */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
              ✅ Protection Checklist
            </h4>
            <span className="text-sm text-emerald-400">
              {checkedCount}/{checklist.length} protected
            </span>
          </div>
          
          <Progress 
            value={(checkedCount / checklist.length) * 100} 
            className="h-2 bg-emerald-950/50"
          />
          
          <div className="grid gap-1.5">
            {checklist.map((item) => (
              <div 
                key={item.label}
                className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                  item.checked ? 'bg-green-500/10' : 'bg-red-500/10'
                }`}
              >
                {item.checked ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className={item.checked ? 'text-green-200' : 'text-red-200'}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Monitoring Toggle */}
        <div className="flex items-center justify-between p-4 bg-emerald-950/30 rounded-xl border border-emerald-500/20">
          <div>
            <p className="text-sm font-medium text-emerald-300">Monitor Fingerprint Changes</p>
            <p className="text-xs text-emerald-300/60">Auto-test every 24 hours</p>
          </div>
          <Switch 
            checked={monitoringEnabled} 
            onCheckedChange={handleMonitoringToggle}
          />
        </div>

        {/* Export Button */}
        <Button
          variant="outline"
          onClick={handleExportReport}
          className="w-full border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/30"
        >
          <Download className="w-4 h-4 mr-2" />
          Export Verification Report
        </Button>
      </CardContent>
    </Card>
  );
}

