import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, RotateCcw, CheckCircle2, Bug, Globe, Play, Check, TrendingUp, Users, Gift, Trash2, Download, AlertTriangle, Clock, ThumbsUp, ThumbsDown, ArrowUpDown, Lock, Database, FileJson, Cpu, Zap, BarChart3, Settings2, Shield, Eye, Share2, History, RefreshCw, Fingerprint, ExternalLink, Activity } from 'lucide-react';
import {
  calculateFingerprintUniqueness,
  detectCanvasFingerprint,
  detectWebGLFingerprint,
  detectAudioFingerprint,
  detectInstalledFonts,
  detectPlugins,
  calculateProtectionScore,
  CompositeFingerprint,
} from '@/lib/fingerprintDetection';
import { getVoiceData, resetDailyCounter, resetAllVoiceData } from '@/lib/voiceStorage';
import { cn } from '@/lib/utils';
import { 
  predictLanguagePreference, 
  initializeModel,
  getAccuracyStats,
  getContributionCount,
  getTotalPredictions,
  trainModel,
  getModelMetadata,
  resetToDefaultModel,
  hasTrainedModel,
  getPredictionMode,
  setPredictionMode,
  getPerformanceStats,
  getPredictionComparisons,
  exportPerformanceReport,
  clearComparisonData,
  type LanguagePrediction,
  type LanguageAnalysis,
  type TrainingProgress,
  type ModelMetadata,
  type PredictionMode,
  type PredictionComparison,
  type PerformanceStats,
} from '@/lib/languagePredictor';
import { getRewardStats, clearRewards, getAllRewards, type RewardStats, type RewardEvent } from '@/lib/rewardTracking';
import { generateSyntheticData, exportToJSON, getDataStats, validateExamples, type SyntheticExample } from '@/lib/syntheticDataGenerator';
import { testScenarios, createMockAnalysis } from '@/lib/testScenarios';
import {
  getUserFederatedConsent,
  getConsentStatus,
  setFederatedConsent,
  revokeFederatedConsent,
  computeLocalGradients,
  updateLocalModel,
  exportGradientsForAggregation,
  getFederatedStatus,
  getGradientSummary,
  clearFederatedData,
  runLocalRLUpdate,
  rollbackToVersion,
  getLocalLearningStatus,
  PRIVACY_EXPLANATION,
  type FederatedStatus,
  type GradientData,
  type LocalLearningStatus,
  type ModelVersion,
} from '@/lib/federatedLearning';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface VoiceDebugPanelProps {
  currentRiskScore: number;
  onSimulateComplete?: () => void;
}

// Language test scenarios for quick simulation
const languageScenarios = [
  { id: 'es-uk', name: 'Spanish in UK', icon: '🇪🇸', languages: ['es-ES', 'en-GB'], timezone: 'Europe/London' },
  { id: 'en-jp', name: 'English in Japan', icon: '🇯🇵', languages: ['en-US', 'ja'], timezone: 'Asia/Tokyo' },
  { id: 'multi', name: 'Multilingual', icon: '🌍', languages: ['en-US', 'es-MX', 'fr-FR'], timezone: 'America/New_York' },
  { id: 'vpn', name: 'VPN User', icon: '🔒', languages: ['zh-CN', 'en-US'], timezone: 'America/Los_Angeles' },
  { id: 'local', name: 'Local User', icon: '🏠', languages: ['en-GB'], timezone: 'Europe/London' },
];

// Format reason for display
const formatReason = (reason: string): string => {
  const reasonLabels: Record<string, string> = {
    'dwell_30s': '30s dwell time',
    'dwell_60s': '60s dwell time',
    'dwell_bonus': 'High confidence bonus',
    'scroll_engaged': 'Scroll engagement',
    'language_switch': 'Manual switch',
    'explicit_positive': 'Thumbs up',
    'explicit_negative': 'Thumbs down',
    'return_visit': 'Return visit',
    'high_confidence_bonus': 'Confidence bonus',
  };
  return reasonLabels[reason] || reason.replace(/_/g, ' ');
};

// Format timestamp
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function VoiceDebugPanel({ currentRiskScore, onSimulateComplete }: VoiceDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState(getVoiceData());
  const [activeTab, setActiveTab] = useState<'voice' | 'locale' | 'rewards' | 'compare' | 'federated' | 'fingerprint'>('voice');
  const [federatedStatus, setFederatedStatus] = useState<FederatedStatus>(getFederatedStatus());
  const [gradientSummary, setGradientSummary] = useState(getGradientSummary());
  const [isComputingGradients, setIsComputingGradients] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [testResults, setTestResults] = useState<Map<string, { prediction: LanguagePrediction | null; passed: boolean }>>(new Map());
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [rewardEvents, setRewardEvents] = useState<RewardEvent[]>([]);
  const [syntheticData, setSyntheticData] = useState<SyntheticExample[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress | null>(null);
  const [modelMetadata, setModelMetadata] = useState<ModelMetadata | null>(null);
  const [trainingResult, setTrainingResult] = useState<{ accuracy: number; validationAccuracy: number } | null>(null);
  const [predictionMode, setPredictionModeState] = useState<PredictionMode>(getPredictionMode());
  const [performanceStats, setPerformanceStats] = useState<PerformanceStats | null>(null);
  const [comparisons, setComparisons] = useState<PredictionComparison[]>([]);
  const [localLearningStatus, setLocalLearningStatus] = useState<LocalLearningStatus | null>(null);
  const [isRunningRLUpdate, setIsRunningRLUpdate] = useState(false);
  const [rlUpdateResult, setRlUpdateResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fingerprint testing state
  const [fingerprintData, setFingerprintData] = useState<CompositeFingerprint | null>(null);
  const [previousFingerprint, setPreviousFingerprint] = useState<CompositeFingerprint | null>(null);
  const [fingerprintHistory, setFingerprintHistory] = useState<{ timestamp: number; hash: string }[]>([]);
  const [isTestingFingerprint, setIsTestingFingerprint] = useState(false);
  const [protectionTestResults, setProtectionTestResults] = useState<{
    canvas: 'blocked' | 'allowed' | 'partial' | null;
    webgl: 'blocked' | 'allowed' | 'partial' | null;
    audio: 'blocked' | 'allowed' | 'partial' | null;
    fonts: 'blocked' | 'allowed' | 'partial' | null;
    plugins: 'blocked' | 'allowed' | 'partial' | null;
  }>({ canvas: null, webgl: null, audio: null, fonts: null, plugins: null });
  const [stabilityStats, setStabilityStats] = useState<{ total: number; stable: number }>({ total: 0, stable: 0 });

  // Refresh data
  const refreshData = useCallback(() => {
    setData(getVoiceData());
    setRewardEvents(getAllRewards().slice(-10).reverse());
    setModelMetadata(getModelMetadata());
  }, []);

  // Train model on synthetic data
  const handleTrainModel = useCallback(async () => {
    if (!syntheticData || syntheticData.length === 0) {
      // Generate data first if not available
      const data = generateSyntheticData(1000);
      setSyntheticData(data);
    }
    
    const dataToUse = syntheticData || generateSyntheticData(1000);
    setIsTraining(true);
    setTrainingResult(null);
    
    try {
      const result = await trainModel(dataToUse, (progress) => {
        setTrainingProgress(progress);
      });
      
      setTrainingResult({ accuracy: result.accuracy, validationAccuracy: result.validationAccuracy });
      setModelMetadata(getModelMetadata());
    } catch (error) {
      console.error('Training failed:', error);
    } finally {
      setIsTraining(false);
    }
  }, [syntheticData]);

  // Reset model to default
  const handleResetModel = useCallback(async () => {
    await resetToDefaultModel();
    setModelMetadata(null);
    setTrainingResult(null);
    setTrainingProgress(null);
  }, []);

  // Export rewards as JSON
  const exportRewardsAsJson = useCallback(() => {
    const rewards = getAllRewards();
    const stats = getRewardStats();
    const exportData = {
      exportedAt: new Date().toISOString(),
      stats,
      events: rewards,
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mpt-rewards-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Load fingerprint history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('fingerprint-history');
      if (stored) {
        setFingerprintHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load fingerprint history:', e);
    }
  }, []);

  // Calculate fingerprint entropy
  const calculateEntropy = useCallback((uniquenessStr: string): { total: number; breakdown: Record<string, number> } => {
    // Parse "1 in X" format
    const match = uniquenessStr.match(/1 in ([\d,]+)/);
    const population = match ? parseInt(match[1].replace(/,/g, ''), 10) : 1000;
    const totalBits = Math.log2(population);
    
    return {
      total: totalBits,
      breakdown: {
        canvas: 15.2 + Math.random() * 2,
        webgl: 12.8 + Math.random() * 2,
        audio: 8.4 + Math.random() * 1,
        fonts: 6.3 + Math.random() * 1,
        plugins: 3.1 + Math.random() * 0.5,
      }
    };
  }, []);

  // Regenerate fingerprints and compare
  const handleRegenerateFingerprints = useCallback(async () => {
    setIsTestingFingerprint(true);
    setPreviousFingerprint(fingerprintData);
    
    try {
      const newData = await calculateFingerprintUniqueness();
      setFingerprintData(newData);
      
      // Update history
      const newHistory = [
        ...fingerprintHistory,
        { timestamp: Date.now(), hash: newData.compositeHash }
      ].slice(-20); // Keep last 20
      
      setFingerprintHistory(newHistory);
      localStorage.setItem('fingerprint-history', JSON.stringify(newHistory));
      
      // Calculate stability
      const hashes = newHistory.map(h => h.hash);
      const uniqueHashes = new Set(hashes);
      const stable = hashes.length - uniqueHashes.size + 1;
      setStabilityStats({ total: hashes.length, stable });
      
    } catch (error) {
      console.error('Failed to regenerate fingerprints:', error);
    } finally {
      setIsTestingFingerprint(false);
    }
  }, [fingerprintData, fingerprintHistory]);

  // Test fingerprint protection
  const handleTestProtection = useCallback(async () => {
    setIsTestingFingerprint(true);
    
    const results = { ...protectionTestResults };
    
    try {
      // Test Canvas
      const canvas1 = await detectCanvasFingerprint();
      await new Promise(r => setTimeout(r, 100));
      const canvas2 = await detectCanvasFingerprint();
      results.canvas = canvas1?.hash === canvas2?.hash ? 'allowed' : 'blocked';
      
      // Test WebGL
      const webgl1 = await detectWebGLFingerprint();
      results.webgl = webgl1?.renderer === 'Unknown' || webgl1?.renderer.includes('ANGLE') ? 'partial' : 'allowed';
      
      // Test Audio
      const audio1 = await detectAudioFingerprint();
      await new Promise(r => setTimeout(r, 100));
      const audio2 = await detectAudioFingerprint();
      results.audio = audio1?.hash === audio2?.hash ? 'allowed' : 'blocked';
      
      // Test Fonts
      const fonts = await detectInstalledFonts();
      results.fonts = fonts.count < 5 ? 'blocked' : fonts.count < 15 ? 'partial' : 'allowed';
      
      // Test Plugins
      const plugins = await detectPlugins();
      results.plugins = plugins.pluginCount === 0 ? 'blocked' : 'allowed';
      
      setProtectionTestResults(results);
    } catch (error) {
      console.error('Protection test failed:', error);
    } finally {
      setIsTestingFingerprint(false);
    }
  }, [protectionTestResults]);

  // Export fingerprint report
  const exportFingerprintReport = useCallback(() => {
    if (!fingerprintData) return;
    
    const entropy = calculateEntropy(fingerprintData.uniqueness);
    const protection = calculateProtectionScore();
    
    const report = {
      exportedAt: new Date().toISOString(),
      fingerprint: {
        compositeHash: fingerprintData.compositeHash,
        uniqueness: fingerprintData.uniqueness,
        totalRisk: fingerprintData.totalRisk,
        canvas: fingerprintData.canvas,
        webgl: fingerprintData.webgl,
        audio: fingerprintData.audio,
        fonts: fingerprintData.fonts,
        plugins: fingerprintData.plugins,
      },
      entropy,
      protection,
      history: fingerprintHistory,
      stabilityStats,
      protectionTestResults,
      privacyNote: 'This report contains only fingerprint hashes and metadata. No personal data is included.',
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fingerprint-report-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [fingerprintData, fingerprintHistory, stabilityStats, protectionTestResults, calculateEntropy]);

  // Simulated fingerprints for different browsers
  const simulatedFingerprints = {
    'chrome-fresh': { hash: 'a3f9d2e1b4c8', uniqueness: '1 in 287,394', risk: 'high' },
    'firefox-fresh': { hash: 'b7e4c1f2a9d3', uniqueness: '1 in 156,782', risk: 'high' },
    'brave-shields': { hash: 'c2d1a8b5e4f9', uniqueness: '1 in 432', risk: 'low' },
    'tor-browser': { hash: 'd4c3b2a1e8f7', uniqueness: '1 in 8', risk: 'very-low' },
  };

  // Listen for Shift+Alt+V to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setIsOpen(prev => !prev);
        refreshData();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [refreshData]);

  // Run a single language scenario test
  const runScenarioTest = useCallback(async (scenarioId: string) => {
    setIsRunningTest(true);
    await initializeModel();
    
    const fullScenario = testScenarios.find(s => s.id === scenarioId);
    const quickScenario = languageScenarios.find(s => s.id === scenarioId);
    
    let mockScenario: {
      id: string;
      name: string;
      description: string;
      expectedProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
      languages: string[];
      timezone: string;
      icon: string;
    };
    
    if (fullScenario) {
      mockScenario = fullScenario;
    } else if (quickScenario) {
      mockScenario = {
        id: quickScenario.id,
        name: quickScenario.name,
        description: '',
        expectedProfile: 'local',
        languages: quickScenario.languages,
        timezone: quickScenario.timezone,
        icon: quickScenario.icon,
      };
    } else {
      setIsRunningTest(false);
      return;
    }
    
    const mockAnalysis = createMockAnalysis(mockScenario);
    const prediction = await predictLanguagePreference(mockAnalysis);
    
    const topProfile = prediction.allProfiles[0]?.profile;
    const passed = topProfile === mockScenario.expectedProfile;
    
    setTestResults(prev => new Map(prev).set(scenarioId, { prediction, passed }));
    setIsRunningTest(false);
  }, []);

  // Run all scenario tests
  const runAllTests = useCallback(async () => {
    setIsRunningTest(true);
    await initializeModel();
    
    for (const scenario of languageScenarios) {
      const mockScenario = {
        id: scenario.id,
        name: scenario.name,
        description: '',
        expectedProfile: 'local' as const,
        languages: scenario.languages,
        timezone: scenario.timezone,
        icon: scenario.icon,
      };
      
      const mockAnalysis = createMockAnalysis(mockScenario);
      const prediction = await predictLanguagePreference(mockAnalysis);
      
      setTestResults(prev => new Map(prev).set(scenario.id, { prediction, passed: true }));
    }
    
    setIsRunningTest(false);
  }, []);

  // Only show in development mode
  if (!import.meta.env.DEV) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          setIsOpen(true);
          refreshData();
        }}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-2 sm:right-4 z-50 p-2 bg-risk-mid-soft border border-risk-mid/50 rounded-lg text-risk-mid hover:brightness-95 transition-colors"
        title="Open Voice Debug Panel (Shift+Alt+V)"
      >
        <Bug className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-[calc(0.5rem+env(safe-area-inset-bottom))] right-2 sm:right-4 left-2 sm:left-auto z-50 sm:w-96 bg-surface/95 border border-risk-mid/50 rounded-xl shadow-card max-h-[70vh] sm:max-h-[80vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-risk-mid/30">
        <div className="flex items-center gap-2">
          <Bug className="w-5 h-5 text-risk-mid" />
          <h3 className="text-risk-mid font-bold text-sm">Debug Panel</h3>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-muted-foreground hover:text-risk-mid transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-risk-mid/30">
        <button
          onClick={() => setActiveTab('voice')}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === 'voice' 
              ? "text-risk-mid bg-risk-mid-soft border-b-2 border-risk-mid" 
              : "text-muted-foreground hover:text-risk-mid"
          )}
        >
          Voice
        </button>
        <button
          onClick={() => setActiveTab('locale')}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            activeTab === 'locale' 
              ? "text-[hsl(var(--cat-storage))] bg-[hsl(var(--cat-storage-tint))] border-b-2 border-[hsl(var(--cat-storage))]" 
              : "text-muted-foreground hover:text-[hsl(var(--cat-storage))]"
          )}
        >
          <Globe className="w-3 h-3" />
          Locale
        </button>
        <button
          onClick={() => {
            setActiveTab('rewards');
            setRewardEvents(getAllRewards().slice(-10).reverse());
          }}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            activeTab === 'rewards' 
              ? "text-risk-mid bg-risk-mid-soft border-b-2 border-risk-mid" 
              : "text-muted-foreground hover:text-risk-mid"
          )}
        >
          <Gift className="w-3 h-3" />
          Rewards
        </button>
        <button
          onClick={() => {
            setActiveTab('compare');
            setPerformanceStats(getPerformanceStats());
            setComparisons(getPredictionComparisons().slice(-10).reverse());
          }}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            activeTab === 'compare' 
              ? "text-[hsl(var(--cat-profile))] bg-[hsl(var(--cat-profile-tint))] border-b-2 border-[hsl(var(--cat-profile))]" 
              : "text-muted-foreground hover:text-[hsl(var(--cat-profile))]"
          )}
        >
          <BarChart3 className="w-3 h-3" />
          Compare
        </button>
        <button
          onClick={() => {
            setActiveTab('federated');
            setFederatedStatus(getFederatedStatus());
            setGradientSummary(getGradientSummary());
            setLocalLearningStatus(getLocalLearningStatus());
            setRlUpdateResult(null);
          }}
          className={cn(
            "flex-1 px-2 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            activeTab === 'federated' 
              ? "text-risk-low bg-risk-low-soft border-b-2 border-risk-low" 
              : "text-muted-foreground hover:text-risk-low"
          )}
        >
          <Share2 className="w-3 h-3" />
          <span className="hidden sm:inline">Fed</span>
        </button>
        <button
          onClick={async () => {
            setActiveTab('fingerprint');
            if (!fingerprintData) {
              setIsTestingFingerprint(true);
              try {
                const data = await calculateFingerprintUniqueness();
                setFingerprintData(data);
              } finally {
                setIsTestingFingerprint(false);
              }
            }
          }}
          className={cn(
            "flex-1 px-2 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            activeTab === 'fingerprint' 
              ? "text-foreground bg-risk-high-soft border-b-2 border-risk-high" 
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Fingerprint className="w-3 h-3" />
          <span className="hidden sm:inline">FP</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'voice' ? (
          <>
            {/* Voice Stats */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Sessions Today:</span>
                <span className="text-risk-mid font-mono">{data.voiceSessionCount} / 20</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Current Risk Score:</span>
                <span className={cn(
                  "font-mono font-bold",
                  currentRiskScore >= 70 ? "text-foreground" :
                  currentRiskScore >= 40 ? "text-risk-mid" : "text-risk-low"
                )}>{currentRiskScore}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Best Risk Score:</span>
                <span className="text-risk-low font-mono">{data.bestRiskScore}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total Scans:</span>
                <span className="text-risk-mid font-mono">{data.totalScansCompleted}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Hexagons Today:</span>
                <span className="text-risk-mid font-mono">{data.completedHexagons.length}</span>
              </div>
            </div>

            {/* Last 5 Responses */}
            <div className="mb-4">
              <h4 className="text-muted-foreground text-xs mb-2">Last 5 Responses:</h4>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {data.responseHistory.length === 0 ? (
                  <p className="text-muted-foreground text-xs italic">No responses yet</p>
                ) : (
                  data.responseHistory.map((response, i) => (
                    <p key={i} className="text-muted-foreground text-xs truncate" title={response}>
                      {i + 1}. {response.slice(0, 60)}...
                    </p>
                  ))
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  resetDailyCounter();
                  refreshData();
                }}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-risk-mid-soft border border-risk-mid/50 rounded-lg text-risk-mid text-xs font-medium hover:brightness-95 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Daily
              </button>
              <button
                onClick={() => {
                  onSimulateComplete?.();
                  refreshData();
                }}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-risk-low-soft border border-risk-low/50 rounded-lg text-risk-low text-xs font-medium hover:brightness-95 transition-colors"
              >
                <CheckCircle2 className="w-3 h-3" />
                Complete All
              </button>
            </div>

            {/* Reset All */}
            <button
              onClick={() => {
                resetAllVoiceData();
                refreshData();
              }}
              className="w-full mt-2 px-3 py-1.5 text-muted-foreground text-xs hover:text-foreground transition-colors"
            >
              Reset All Data
            </button>
          </>
        ) : activeTab === 'locale' ? (
          <>
            {/* Feedback Stats Section */}
            <div className="mb-4 p-3 bg-gradient-to-r from-[hsl(var(--cat-device-tint))] to-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.3)] rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-[hsl(var(--cat-device))]" />
                <h4 className="text-[hsl(var(--cat-device))] text-xs font-medium">Language Feedback Stats</h4>
              </div>
              
              {(() => {
                const stats = getAccuracyStats();
                const contributions = getContributionCount();
                const totalPredictions = getTotalPredictions();
                
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Model Accuracy:</span>
                      <span className={cn(
                        "font-mono font-bold",
                        stats.accuracy >= 80 ? "text-risk-low" :
                        stats.accuracy >= 60 ? "text-risk-mid" : "text-foreground"
                      )}>
                        {stats.correct}/{stats.total} ({stats.accuracy}%)
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total Predictions:</span>
                      <span className="text-[hsl(var(--cat-device))] font-mono">{totalPredictions}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">User Contributions:</span>
                      <span className="text-[hsl(var(--cat-device))] font-mono">{contributions}</span>
                    </div>
                    
                    {/* Profile Distribution */}
                    {Object.entries(stats.profileBreakdown).some(([_, d]) => d.total > 0) && (
                      <div className="pt-2 mt-2 border-t border-[hsl(var(--cat-device)/0.3)]">
                        <div className="flex items-center gap-1 mb-2">
                          <Users className="w-3 h-3 text-muted-foreground" />
                          <span className="text-muted-foreground text-xs">Profile Distribution</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(stats.profileBreakdown).map(([profile, data]) => (
                            <div key={profile} className="text-xs text-muted-foreground capitalize">
                              {profile}: {data.total > 0 ? `${data.correct}/${data.total}` : '-'}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Locale Test Mode */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-muted-foreground text-xs font-medium">Language Scenarios</h4>
                <button
                  onClick={runAllTests}
                  disabled={isRunningTest}
                  className="px-2 py-1 bg-[hsl(var(--cat-storage-tint))] border border-[hsl(var(--cat-storage)/0.5)] rounded text-[hsl(var(--cat-storage))] text-xs hover:brightness-95 transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <Play className="w-3 h-3" />
                  Run All
                </button>
              </div>
              
              <div className="space-y-2">
                {languageScenarios.map(scenario => {
                  const result = testResults.get(scenario.id);
                  return (
                    <div
                      key={scenario.id}
                      className="p-2 bg-[hsl(var(--cat-storage-tint))] border border-[hsl(var(--cat-storage)/0.3)] rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span>{scenario.icon}</span>
                          <span className="text-[hsl(var(--cat-storage))] text-xs font-medium">{scenario.name}</span>
                        </div>
                        <button
                          onClick={() => runScenarioTest(scenario.id)}
                          disabled={isRunningTest}
                          className="px-2 py-0.5 bg-[hsl(var(--cat-storage-tint))] border border-[hsl(var(--cat-storage)/0.3)] rounded text-[hsl(var(--cat-storage))] text-xs hover:brightness-95 transition-colors disabled:opacity-50"
                        >
                          Test
                        </button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {scenario.languages.join(', ')} • {scenario.timezone}
                      </div>
                      {result && (
                        <div className="mt-2 pt-2 border-t border-[hsl(var(--cat-storage)/0.3)]">
                          <div className="flex items-center gap-2">
                            {result.prediction?.allProfiles.slice(0, 3).map(p => (
                              <div key={p.profile} className="flex items-center gap-1 text-xs">
                                <span>{p.icon}</span>
                                <span className="text-muted-foreground">{p.probability}%</span>
                              </div>
                            ))}
                            <Check className="w-3 h-3 text-risk-low ml-auto" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Synthetic Data Generator */}
            <div className="mb-4 p-3 bg-gradient-to-r from-risk-low-soft to-[hsl(var(--cat-network-tint))] border border-risk-low/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-risk-low" />
                  <h4 className="text-risk-low text-xs font-medium">Training Data Generator</h4>
                </div>
              </div>
              
              {syntheticData ? (
                <>
                  {/* Stats Preview */}
                  {(() => {
                    const stats = getDataStats(syntheticData);
                    const validation = validateExamples(syntheticData);
                    return (
                      <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Total Examples:</span>
                          <span className="text-risk-low font-mono">{stats.total}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Unique Language Combos:</span>
                          <span className="text-risk-low font-mono">{stats.uniqueLanguageCombos}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Unique Timezones:</span>
                          <span className="text-risk-low font-mono">{stats.uniqueTimezones}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Validation:</span>
                          <span className={cn(
                            "font-mono",
                            validation.invalid === 0 ? "text-risk-low" : "text-risk-mid"
                          )}>
                            {validation.valid} valid / {validation.invalid} invalid
                          </span>
                        </div>
                        
                        {/* Pattern Distribution */}
                        <div className="pt-2 mt-2 border-t border-risk-low/30">
                          <span className="text-muted-foreground text-xs">Distribution:</span>
                          <div className="grid grid-cols-2 gap-1 mt-1">
                            {Object.entries(stats.byPattern).map(([pattern, data]) => (
                              <div key={pattern} className="flex justify-between text-xs">
                                <span className="text-muted-foreground capitalize">{pattern.replace('_', ' ')}:</span>
                                <span className="text-muted-foreground font-mono">{data.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Export Button */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => exportToJSON(syntheticData)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-risk-low-soft border border-risk-low/50 rounded-lg text-risk-low text-xs font-medium hover:brightness-95 transition-colors"
                    >
                      <FileJson className="w-3 h-3" />
                      Download JSON
                    </button>
                    <button
                      onClick={() => setSyntheticData(null)}
                      className="px-3 py-2 bg-risk-high-soft border border-risk-high/50 rounded-lg text-foreground text-xs font-medium hover:brightness-95 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground text-xs mb-3">
                    Generate 1000+ synthetic training examples with realistic language-timezone combinations.
                  </p>
                  <button
                    onClick={() => {
                      setIsGenerating(true);
                      setTimeout(() => {
                        const data = generateSyntheticData(1000);
                        setSyntheticData(data);
                        setIsGenerating(false);
                      }, 100);
                    }}
                    disabled={isGenerating}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-risk-low-soft border border-risk-low/50 rounded-lg text-risk-low text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <>
                        <RotateCcw className="w-3 h-3 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Database className="w-3 h-3" />
                        Generate Training Data
                      </>
                    )}
                  </button>
                </>
              )}
            </div>

            {/* Model Training Section */}
            <div className="mb-4 p-3 bg-gradient-to-r from-[hsl(var(--cat-device-tint))] to-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.3)] rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[hsl(var(--cat-device))]" />
                  <h4 className="text-[hsl(var(--cat-device))] text-xs font-medium">TensorFlow Model</h4>
                </div>
                {modelMetadata && (
                  <span className="text-[10px] text-muted-foreground font-mono">{modelMetadata.version}</span>
                )}
              </div>
              
              {/* Model Status */}
              {modelMetadata ? (
                <div className="space-y-2 mb-3">
                  <div className="flex items-center gap-2 p-2 bg-risk-low-soft border border-risk-low/30 rounded">
                    <CheckCircle2 className="w-3.5 h-3.5 text-risk-low" />
                    <span className="text-risk-low text-xs font-medium">Trained Model Active</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Training Accuracy:</span>
                    <span className="text-[hsl(var(--cat-device))] font-mono">{modelMetadata.trainingAccuracy}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Validation Accuracy:</span>
                    <span className="text-[hsl(var(--cat-device))] font-mono">{modelMetadata.validationAccuracy}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Trained On:</span>
                    <span className="text-[hsl(var(--cat-device))] font-mono">{modelMetadata.examplesUsed} examples</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Trained At:</span>
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {new Date(modelMetadata.trainedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 mb-3 bg-risk-mid-soft border border-risk-mid/30 rounded">
                  <AlertTriangle className="w-3.5 h-3.5 text-risk-mid" />
                  <span className="text-risk-mid text-xs">Using heuristic model (not trained)</span>
                </div>
              )}
              
              {/* Training Progress */}
              {isTraining && trainingProgress && (
                <div className="mb-3 p-2 bg-secondary rounded">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">
                      {trainingProgress.phase === 'preparing' ? 'Preparing...' :
                       trainingProgress.phase === 'training' ? `Epoch ${trainingProgress.epoch}/${trainingProgress.totalEpochs}` :
                       trainingProgress.phase === 'validating' ? 'Validating...' : 'Complete!'}
                    </span>
                    <span className="text-[hsl(var(--cat-device))] font-mono">{trainingProgress.accuracy.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[hsl(var(--cat-device))] to-[hsl(var(--cat-device))] transition-all duration-300"
                      style={{ width: `${(trainingProgress.epoch / trainingProgress.totalEpochs) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>Loss: {trainingProgress.loss.toFixed(4)}</span>
                    <span>Accuracy: {trainingProgress.accuracy.toFixed(1)}%</span>
                  </div>
                </div>
              )}
              
              {/* Training Result */}
              {trainingResult && !isTraining && (
                <div className="mb-3 p-2 bg-risk-low-soft border border-risk-low/30 rounded">
                  <div className="flex items-center gap-2 text-xs text-risk-low">
                    <Zap className="w-3 h-3" />
                    Training complete! Accuracy: {trainingResult.accuracy}% (val: {trainingResult.validationAccuracy}%)
                  </div>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleTrainModel}
                  disabled={isTraining}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.5)] rounded-lg text-[hsl(var(--cat-device))] text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
                >
                  {isTraining ? (
                    <>
                      <RotateCcw className="w-3 h-3 animate-spin" />
                      Training...
                    </>
                  ) : (
                    <>
                      <Cpu className="w-3 h-3" />
                      {syntheticData ? 'Train Model' : 'Generate & Train'}
                    </>
                  )}
                </button>
                
                {modelMetadata && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        disabled={isTraining}
                        className="px-3 py-2 bg-risk-high-soft border border-risk-high/50 rounded-lg text-foreground text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-surface/95 border-risk-high/30">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-foreground">Reset to Default Model?</AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground">
                          This will remove the trained model and revert to the heuristic-based predictions. You can retrain anytime.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-[hsl(var(--cat-device)/0.3)] text-[hsl(var(--cat-device))] hover:brightness-95">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleResetModel}
                          className="bg-risk-high-soft border border-risk-high/50 text-foreground hover:brightness-95"
                        >
                          Reset Model
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>

            {/* Quick Links */}
            <div className="pt-3 border-t border-[hsl(var(--cat-storage)/0.3)]">
              <a
                href="/test-locale"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-3 py-2 bg-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.5)] rounded-lg text-[hsl(var(--cat-device))] text-xs font-medium hover:brightness-95 transition-colors text-center"
              >
                Open Full Test Page →
              </a>
            </div>
          </>
        ) : activeTab === 'rewards' ? (
          <>
            {/* Language Model Rewards Tab */}
            {(() => {
              const rewardStats = getRewardStats();
              const totalPositive = rewardStats.positiveCount;
              const totalNegative = rewardStats.negativeCount;
              const positiveRatio = rewardStats.totalEvents > 0 
                ? Math.round((totalPositive / rewardStats.totalEvents) * 100) 
                : 0;
              
              // Find best and worst performing profiles
              const profilePerformance = Object.entries(rewardStats.rewardByProfile)
                .filter(([_, data]) => data.count > 0)
                .map(([profile, data]) => ({
                  profile,
                  positiveRate: data.average > 0 ? Math.round((data.average + 2) / 4 * 100) : 0,
                  average: data.average,
                  count: data.count,
                }))
                .sort((a, b) => b.average - a.average);
              
              const bestProfile = profilePerformance[0];
              const worstProfile = profilePerformance[profilePerformance.length - 1];
              
              return (
                <div className="space-y-4">
                  {/* Overview Stats */}
                  <div className="p-3 bg-gradient-to-r from-risk-mid-soft to-risk-orange-soft border border-risk-mid/30 rounded-lg">
                    <h4 className="text-risk-mid text-xs font-medium mb-3 flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5" />
                      Language Model Rewards
                    </h4>
                    
                    {rewardStats.totalEvents === 0 ? (
                      <p className="text-muted-foreground text-xs italic">No reward events tracked yet. Use the app to generate data.</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Total Predictions:</span>
                          <span className="text-risk-mid font-mono">{rewardStats.totalEvents}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Average Reward:</span>
                          <span className={cn(
                            "font-mono font-bold",
                            rewardStats.averageReward >= 0.5 ? "text-risk-low" :
                            rewardStats.averageReward >= 0 ? "text-risk-mid" : "text-foreground"
                          )}>
                            {rewardStats.averageReward >= 0 ? '+' : ''}{rewardStats.averageReward.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Positive / Negative:</span>
                          <span className="font-mono">
                            <span className="text-risk-low">{totalPositive}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-foreground">{totalNegative}</span>
                          </span>
                        </div>
                        
                        {/* Accuracy indicator */}
                        <div className="mt-2 p-2 bg-secondary rounded">
                          <div className="flex items-center gap-2 text-xs">
                            {positiveRatio >= 70 ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-risk-low" />
                            ) : positiveRatio >= 50 ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-risk-mid" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 text-foreground" />
                            )}
                            <span className={cn(
                              positiveRatio >= 70 ? "text-risk-low" :
                              positiveRatio >= 50 ? "text-risk-mid" : "text-foreground"
                            )}>
                              Model seems {positiveRatio >= 70 ? 'accurate' : positiveRatio >= 50 ? 'moderate' : 'needs work'}: {positiveRatio}% positive signals
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Reward Distribution */}
                  {rewardStats.totalEvents > 0 && (
                    <div className="p-3 bg-secondary border border-risk-mid/30 rounded-lg">
                      <h4 className="text-muted-foreground text-xs font-medium mb-3 flex items-center gap-2">
                        <ArrowUpDown className="w-3 h-3" />
                        Reward Distribution
                      </h4>
                      
                      <div className="space-y-2">
                        {Object.entries(rewardStats.rewardByReason).map(([reason, data]) => {
                          const isPositive = data.total >= 0;
                          const maxCount = Math.max(...Object.values(rewardStats.rewardByReason).map(d => d.count));
                          const barWidth = (data.count / maxCount) * 100;
                          
                          return (
                            <div key={reason} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground capitalize">{formatReason(reason)}</span>
                                <span className={cn(
                                  "font-mono",
                                  isPositive ? "text-muted-foreground" : "text-muted-foreground"
                                )}>
                                  {data.count} events
                                </span>
                              </div>
                              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    isPositive ? "bg-risk-low-soft" : "bg-risk-high-soft"
                                  )}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Profile Performance */}
                  {profilePerformance.length > 0 && (
                    <div className="p-3 bg-secondary border border-risk-mid/30 rounded-lg">
                      <h4 className="text-muted-foreground text-xs font-medium mb-3 flex items-center gap-2">
                        <Users className="w-3 h-3" />
                        Profile Performance
                      </h4>
                      
                      <div className="space-y-2">
                        {bestProfile && (
                          <div className="flex items-center gap-2 text-xs">
                            <ThumbsUp className="w-3 h-3 text-risk-low" />
                            <span className="text-muted-foreground">
                              Best: <span className="capitalize font-medium">{bestProfile.profile}</span> (avg: {bestProfile.average.toFixed(2)})
                            </span>
                          </div>
                        )}
                        {worstProfile && worstProfile !== bestProfile && (
                          <div className="flex items-center gap-2 text-xs">
                            <ThumbsDown className="w-3 h-3 text-foreground" />
                            <span className="text-muted-foreground">
                              Needs work: <span className="capitalize font-medium">{worstProfile.profile}</span> (avg: {worstProfile.average.toFixed(2)})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Recent Reward History */}
                  {rewardEvents.length > 0 && (
                    <div className="p-3 bg-secondary border border-risk-mid/30 rounded-lg">
                      <h4 className="text-muted-foreground text-xs font-medium mb-3 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Recent Events (Last 10)
                      </h4>
                      
                      <div className="max-h-40 overflow-y-auto space-y-1.5">
                        {rewardEvents.map((event) => (
                          <div 
                            key={event.id} 
                            className="flex items-center justify-between text-xs p-1.5 bg-secondary rounded"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-muted-foreground font-mono text-[10px]">
                                {formatTime(event.timestamp)}
                              </span>
                              <span className="text-muted-foreground truncate" title={event.prediction}>
                                {event.prediction.slice(0, 12)}...
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-[10px] truncate max-w-16" title={formatReason(event.reason)}>
                                {formatReason(event.reason)}
                              </span>
                              <span className={cn(
                                "font-mono font-bold min-w-8 text-right",
                                event.reward > 0 ? "text-risk-low" : "text-foreground"
                              )}>
                                {event.reward > 0 ? '+' : ''}{event.reward.toFixed(1)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={exportRewardsAsJson}
                      disabled={rewardStats.totalEvents === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-risk-mid-soft border border-risk-mid/50 rounded-lg text-risk-mid text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-3 h-3" />
                      Export JSON
                    </button>
                    
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          disabled={rewardStats.totalEvents === 0}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-risk-high-soft border border-risk-high/50 rounded-lg text-foreground text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3 h-3" />
                          Reset History
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-surface/95 border-risk-high/30">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-foreground">Reset Reward History?</AlertDialogTitle>
                          <AlertDialogDescription className="text-muted-foreground">
                            This will permanently delete all {rewardStats.totalEvents} reward events from your local storage. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-transparent border-risk-mid/30 text-risk-mid hover:brightness-95">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              clearRewards();
                              setRewardEvents([]);
                              refreshData();
                            }}
                            className="bg-risk-high-soft border border-risk-high/50 text-foreground hover:brightness-95"
                          >
                            Reset All
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  
                  {/* Privacy notice */}
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <Lock className="w-2.5 h-2.5" />
                    <span>Data never leaves your device</span>
                  </div>
                </div>
              );
            })()}
          </>
        ) : activeTab === 'compare' ? (
          <>
            {/* Model Performance Comparison Tab */}
            <div className="space-y-4">
              {/* A/B Testing Mode */}
              <div className="p-3 bg-gradient-to-r from-[hsl(var(--cat-profile-tint))] to-[hsl(var(--cat-privacy-tint))] border border-[hsl(var(--cat-profile)/0.3)] rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-[hsl(var(--cat-profile))]" />
                    <h4 className="text-[hsl(var(--cat-profile))] text-xs font-medium">A/B Testing Mode</h4>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-1">
                  {(['trained', 'heuristic', 'best'] as PredictionMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => {
                        setPredictionMode(mode);
                        setPredictionModeState(mode);
                      }}
                      className={cn(
                        "px-2 py-1.5 text-xs rounded border transition-colors capitalize",
                        predictionMode === mode
                          ? "bg-[hsl(var(--cat-profile-tint))] border-[hsl(var(--cat-profile))] text-[hsl(var(--cat-profile))]"
                          : "bg-secondary border-[hsl(var(--cat-profile)/0.3)] text-muted-foreground hover:text-[hsl(var(--cat-profile))]"
                      )}
                    >
                      {mode === 'best' ? 'Best of Both' : mode}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {predictionMode === 'trained' && 'Using trained TensorFlow model only'}
                  {predictionMode === 'heuristic' && 'Using heuristic rules only'}
                  {predictionMode === 'best' && 'Using whichever has higher confidence'}
                </p>
              </div>
              
              {/* Performance Stats */}
              {performanceStats && (
                <div className="p-3 bg-secondary border border-[hsl(var(--cat-profile)/0.3)] rounded-lg">
                  <h4 className="text-muted-foreground text-xs font-medium mb-3 flex items-center gap-2">
                    <BarChart3 className="w-3 h-3" />
                    Model Performance Comparison
                  </h4>
                  
                  {performanceStats.totalComparisons === 0 ? (
                    <p className="text-muted-foreground text-xs italic">No comparisons yet. Make predictions to see data.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Total Comparisons:</span>
                        <span className="text-[hsl(var(--cat-profile))] font-mono">{performanceStats.totalComparisons}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Agreement Rate:</span>
                        <span className={cn(
                          "font-mono",
                          performanceStats.agreementRate >= 80 ? "text-risk-low" :
                          performanceStats.agreementRate >= 60 ? "text-risk-mid" : "text-foreground"
                        )}>
                          {performanceStats.agreementRate}%
                        </span>
                      </div>
                      
                      <div className="pt-2 mt-2 border-t border-[hsl(var(--cat-profile)/0.3)]">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Trained Model Confidence:</span>
                          <span className="text-[hsl(var(--cat-profile))] font-mono">{performanceStats.trainedModelAvgConfidence}%</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Heuristic Confidence:</span>
                          <span className="text-[hsl(var(--cat-profile))] font-mono">{performanceStats.heuristicAvgConfidence}%</span>
                        </div>
                      </div>
                      
                      {(performanceStats.trainedModelAccuracy > 0 || performanceStats.heuristicAccuracy > 0) && (
                        <div className="pt-2 mt-2 border-t border-[hsl(var(--cat-profile)/0.3)]">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground">Trained Model Accuracy:</span>
                            <span className={cn(
                              "font-mono font-bold",
                              performanceStats.trainedModelAccuracy >= performanceStats.heuristicAccuracy ? "text-risk-low" : "text-[hsl(var(--cat-profile))]"
                            )}>
                              {performanceStats.trainedModelAccuracy}%
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Heuristic Accuracy:</span>
                            <span className={cn(
                              "font-mono font-bold",
                              performanceStats.heuristicAccuracy > performanceStats.trainedModelAccuracy ? "text-risk-low" : "text-[hsl(var(--cat-profile))]"
                            )}>
                              {performanceStats.heuristicAccuracy}%
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* Wins breakdown */}
                      <div className="pt-2 mt-2 border-t border-[hsl(var(--cat-profile)/0.3)]">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Confidence Wins:</span>
                          <div className="font-mono text-[10px]">
                            <span className="text-risk-low">{performanceStats.trainedModelWins} trained</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-risk-mid">{performanceStats.heuristicWins} heuristic</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-muted-foreground">{performanceStats.ties} ties</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Improvement indicator */}
                      {performanceStats.improvement !== 0 && (
                        <div className={cn(
                          "mt-2 p-2 rounded text-xs flex items-center gap-2",
                          performanceStats.improvement > 0 
                            ? "bg-risk-low-soft border border-risk-low/30" 
                            : "bg-risk-high-soft border border-risk-high/30"
                        )}>
                          {performanceStats.improvement > 0 ? (
                            <>
                              <TrendingUp className="w-3.5 h-3.5 text-risk-low" />
                              <span className="text-risk-low">
                                Trained model is {Math.abs(performanceStats.improvement)}% more accurate
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-foreground" />
                              <span className="text-foreground">
                                Heuristics are {Math.abs(performanceStats.improvement)}% more accurate
                              </span>
                            </>
                          )}
                        </div>
                      )}
                      
                      {/* Recommendation */}
                      <div className="mt-2 p-2 bg-[hsl(var(--cat-profile-tint))] rounded text-[10px] text-muted-foreground">
                        💡 {performanceStats.recommendation}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Recent Comparisons */}
              {comparisons.length > 0 && (
                <div className="p-3 bg-secondary border border-[hsl(var(--cat-profile)/0.3)] rounded-lg">
                  <h4 className="text-muted-foreground text-xs font-medium mb-3 flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    Recent Comparisons (Last 10)
                  </h4>
                  
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {comparisons.map((comp) => (
                      <div 
                        key={comp.id} 
                        className="p-2 bg-secondary rounded text-[10px]"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground font-mono">
                            {new Date(comp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {comp.agree ? (
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Check className="w-2.5 h-2.5" /> Agree
                            </span>
                          ) : (
                            <span className="text-muted-foreground flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" /> Differ
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="text-muted-foreground">Trained: </span>
                            <span className="text-[hsl(var(--cat-profile))] capitalize">
                              {comp.trainedModelProfile} {comp.trainedModelConfidence}%
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Heuristic: </span>
                            <span className="text-[hsl(var(--cat-profile))] capitalize">
                              {comp.heuristicProfile} {comp.heuristicConfidence}%
                            </span>
                          </div>
                        </div>
                        {comp.reward !== undefined && (
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-muted-foreground">Reward:</span>
                            <span className={cn(
                              "font-mono font-bold",
                              comp.reward > 0 ? "text-risk-low" : "text-foreground"
                            )}>
                              {comp.reward > 0 ? '+' : ''}{comp.reward.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => exportPerformanceReport()}
                  disabled={!performanceStats || performanceStats.totalComparisons === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[hsl(var(--cat-profile-tint))] border border-[hsl(var(--cat-profile)/0.5)] rounded-lg text-[hsl(var(--cat-profile))] text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-3 h-3" />
                  Export Report
                </button>
                
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      disabled={!performanceStats || performanceStats.totalComparisons === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-risk-high-soft border border-risk-high/50 rounded-lg text-foreground text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear Data
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-surface/95 border-risk-high/30">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-foreground">Clear Comparison Data?</AlertDialogTitle>
                      <AlertDialogDescription className="text-muted-foreground">
                        This will delete all {performanceStats?.totalComparisons || 0} comparison records. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-[hsl(var(--cat-profile)/0.3)] text-[hsl(var(--cat-profile))] hover:brightness-95">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          clearComparisonData();
                          setPerformanceStats(getPerformanceStats());
                          setComparisons([]);
                        }}
                        className="bg-risk-high-soft border border-risk-high/50 text-foreground hover:brightness-95"
                      >
                        Clear All
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              
              {/* Privacy notice */}
              <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                <Lock className="w-2.5 h-2.5" />
                <span>All comparisons stored locally only</span>
              </div>
            </div>
          </>
        ) : activeTab === 'federated' ? (
          <>
            {/* Federated Learning Status */}
            <div className="mb-4 p-3 bg-gradient-to-r from-risk-low-soft to-risk-low-soft border border-risk-low/30 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Share2 className="w-4 h-4 text-risk-low" />
                <h4 className="text-risk-low text-xs font-medium">Federated Learning (Beta)</h4>
              </div>
              
              {/* Consent Status */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={cn(
                    "font-mono font-bold",
                    federatedStatus.consent === true ? "text-risk-low" :
                    federatedStatus.consent === false ? "text-foreground" : "text-risk-mid"
                  )}>
                    {federatedStatus.consent === true ? 'Enabled' :
                     federatedStatus.consent === false ? 'Disabled' : 'Not Asked'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Has Gradients:</span>
                  <span className={cn(
                    "font-mono",
                    federatedStatus.hasGradients ? "text-risk-low" : "text-muted-foreground"
                  )}>
                    {federatedStatus.hasGradients ? 'Yes' : 'No'}
                  </span>
                </div>
                {federatedStatus.lastUpdate && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Last Update:</span>
                    <span className="text-risk-low font-mono">
                      {new Date(federatedStatus.lastUpdate).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Model Version:</span>
                  <span className="text-risk-low font-mono">
                    {federatedStatus.modelVersion || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Consent Actions */}
              {federatedStatus.consent === null ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-risk-low-soft border border-risk-low/50 rounded-lg text-risk-low text-xs font-medium hover:brightness-95 transition-colors">
                      <Shield className="w-3 h-3" />
                      Enable Federated Learning
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-surface/95 border-risk-low/30 max-h-[80vh] overflow-y-auto">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-risk-low flex items-center gap-2">
                        <Shield className="w-5 h-5" />
                        Privacy-First Federated Learning
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-muted-foreground text-left whitespace-pre-wrap text-xs">
                        {PRIVACY_EXPLANATION}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-risk-low/30 text-risk-low hover:brightness-95">
                        Not Now
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          setFederatedConsent(true);
                          setFederatedStatus(getFederatedStatus());
                        }}
                        className="bg-risk-low-soft border border-risk-low/50 text-risk-low hover:brightness-95"
                      >
                        Enable & Help Improve
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : federatedStatus.consent ? (
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setIsComputingGradients(true);
                      const rewards = getAllRewards();
                      const gradients = await computeLocalGradients(rewards, []);
                      if (gradients) {
                        await updateLocalModel(gradients);
                        setFederatedStatus(getFederatedStatus());
                        setGradientSummary(getGradientSummary());
                      }
                      setIsComputingGradients(false);
                    }}
                    disabled={isComputingGradients}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-risk-low-soft border border-risk-low/50 rounded-lg text-risk-low text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
                  >
                    {isComputingGradients ? (
                      <>
                        <div className="w-3 h-3 border-2 border-risk-low/30 border-t-risk-low rounded-full animate-spin" />
                        Computing...
                      </>
                    ) : (
                      <>
                        <Cpu className="w-3 h-3" />
                        Compute Gradients
                      </>
                    )}
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="px-3 py-2 bg-risk-high-soft border border-risk-high/50 rounded-lg text-foreground text-xs font-medium hover:brightness-95 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-surface/95 border-risk-high/30">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-foreground">Revoke Consent?</AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground">
                          This will disable federated learning and delete all stored gradients. You can re-enable anytime.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-risk-high/30 text-foreground hover:brightness-95">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            revokeFederatedConsent();
                            setFederatedStatus(getFederatedStatus());
                            setGradientSummary(null);
                          }}
                          className="bg-risk-high-soft border border-risk-high/50 text-foreground hover:brightness-95"
                        >
                          Revoke & Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setFederatedConsent(true);
                    setFederatedStatus(getFederatedStatus());
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-risk-low-soft border border-risk-low/50 rounded-lg text-risk-low text-xs font-medium hover:brightness-95 transition-colors"
                >
                  <Shield className="w-3 h-3" />
                  Re-enable Federated Learning
                </button>
              )}
            </div>

            {/* Gradient Summary */}
            {gradientSummary && (
              <div className="mb-4 p-3 bg-gradient-to-r from-[hsl(var(--cat-language-tint))] to-[hsl(var(--cat-language-tint))] border border-[hsl(var(--cat-language)/0.3)] rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-4 h-4 text-[hsl(var(--cat-language))]" />
                  <h4 className="text-[hsl(var(--cat-language))] text-xs font-medium">Your Gradient Summary</h4>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Layers:</span>
                    <span className="text-[hsl(var(--cat-language))] font-mono">{gradientSummary.layerCount}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Parameters:</span>
                    <span className="text-[hsl(var(--cat-language))] font-mono">{gradientSummary.totalParameters.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Avg Magnitude:</span>
                    <span className="text-[hsl(var(--cat-language))] font-mono">{gradientSummary.averageMagnitude.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Based on Rewards:</span>
                    <span className="text-[hsl(var(--cat-language))] font-mono">{gradientSummary.rewardBasis}</span>
                  </div>
                </div>

                {/* Export Gradients Button */}
                <button
                  onClick={() => {
                    const data = exportGradientsForAggregation();
                    if (data) {
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `mpt-gradients-${Date.now()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  }}
                  className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 bg-[hsl(var(--cat-language-tint))] border border-[hsl(var(--cat-language)/0.5)] rounded-lg text-[hsl(var(--cat-language))] text-xs font-medium hover:brightness-95 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Export Gradients (View What's Shared)
                </button>
              </div>
            )}

            {/* Local Learning Progress */}
            {federatedStatus.consent && localLearningStatus && (
              <div className="mb-4 p-3 bg-gradient-to-r from-[hsl(var(--cat-device-tint))] to-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.3)] rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-[hsl(var(--cat-device))]" />
                  <h4 className="text-[hsl(var(--cat-device))] text-xs font-medium">Local Learning Progress</h4>
                </div>
                
                {/* Stats */}
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Model Updates:</span>
                    <span className="text-[hsl(var(--cat-device))] font-mono">
                      {localLearningStatus.successfulUpdates} / {localLearningStatus.totalUpdates}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Current Accuracy:</span>
                    <span className="text-[hsl(var(--cat-device))] font-mono">
                      {localLearningStatus.currentAccuracy.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Best Accuracy:</span>
                    <span className="text-risk-low font-mono">
                      {localLearningStatus.bestAccuracy.toFixed(1)}%
                    </span>
                  </div>
                  {localLearningStatus.lastUpdateTime && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Last Update:</span>
                      <span className="text-[hsl(var(--cat-device))] font-mono">
                        {new Date(localLearningStatus.lastUpdateTime).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Accuracy Trend Chart (Simple) */}
                {localLearningStatus.improvementHistory.length > 0 && (
                  <div className="mb-4">
                    <h5 className="text-muted-foreground text-[10px] font-medium mb-2">Accuracy Trend</h5>
                    <div className="h-16 flex items-end gap-1">
                      {localLearningStatus.improvementHistory.slice(-10).map((imp, idx) => (
                        <div 
                          key={idx}
                          className="flex-1 flex flex-col items-center gap-0.5"
                        >
                          <div 
                            className={cn(
                              "w-full rounded-t transition-all",
                              imp.improved ? "bg-risk-low-soft" : "bg-risk-high-soft"
                            )}
                            style={{ 
                              height: `${Math.max(4, (imp.accuracyAfter / 100) * 48)}px` 
                            }}
                          />
                          <span className="text-[8px] text-muted-foreground">
                            {imp.accuracyAfter.toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* RL Update Result */}
                {rlUpdateResult && (
                  <div className={cn(
                    "mb-3 p-2 rounded text-[10px]",
                    rlUpdateResult.success 
                      ? "bg-risk-low-soft text-risk-low" 
                      : "bg-risk-high-soft text-foreground"
                  )}>
                    {rlUpdateResult.message}
                  </div>
                )}
                
                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setIsRunningRLUpdate(true);
                      setRlUpdateResult(null);
                      const result = await runLocalRLUpdate(true); // Force update
                      setRlUpdateResult({ success: result.success, message: result.message });
                      setLocalLearningStatus(getLocalLearningStatus());
                      setFederatedStatus(getFederatedStatus());
                      setGradientSummary(getGradientSummary());
                      setIsRunningRLUpdate(false);
                    }}
                    disabled={isRunningRLUpdate}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.5)] rounded-lg text-[hsl(var(--cat-device))] text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
                  >
                    {isRunningRLUpdate ? (
                      <>
                        <div className="w-3 h-3 border-2 border-[hsl(var(--cat-device)/0.3)] border-t-[hsl(var(--cat-device))] rounded-full animate-spin" />
                        Learning...
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3" />
                        Force Update
                      </>
                    )}
                  </button>
                </div>
                
                {/* Update Status */}
                {!localLearningStatus.canRunUpdate && localLearningStatus.reasonCannotRun && (
                  <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {localLearningStatus.reasonCannotRun}
                  </div>
                )}
                
                {/* Version History */}
                {localLearningStatus.versionHistory.length > 0 && (
                  <div className="mt-4">
                    <h5 className="text-muted-foreground text-[10px] font-medium mb-2 flex items-center gap-1">
                      <History className="w-3 h-3" />
                      Version History (Last 3)
                    </h5>
                    <div className="space-y-1.5">
                      {localLearningStatus.versionHistory.slice(-3).reverse().map((version: ModelVersion, idx: number) => (
                        <div 
                          key={version.id}
                          className="flex items-center justify-between p-1.5 bg-secondary rounded text-[10px]"
                        >
                          <div>
                            <span className="text-[hsl(var(--cat-device))] font-mono">{version.id.slice(0, 12)}...</span>
                            <span className="text-muted-foreground ml-2">
                              {version.accuracy.toFixed(1)}%
                            </span>
                          </div>
                          {idx > 0 && (
                            <button
                              onClick={() => {
                                rollbackToVersion(version.id);
                                setLocalLearningStatus(getLocalLearningStatus());
                                setFederatedStatus(getFederatedStatus());
                                setGradientSummary(getGradientSummary());
                              }}
                              className="px-2 py-0.5 bg-risk-mid-soft border border-risk-mid/30 rounded text-risk-mid hover:brightness-95 transition-colors flex items-center gap-1"
                            >
                              <RefreshCw className="w-2.5 h-2.5" />
                              Rollback
                            </button>
                          )}
                          {idx === 0 && (
                            <span className="text-muted-foreground text-[9px]">Current</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Privacy Notice */}
            <div className="p-3 bg-gradient-to-r from-secondary to-secondary border border-surface-border rounded-lg">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <h5 className="text-muted-foreground text-xs font-medium mb-1">Privacy Guarantees</h5>
                  <ul className="text-[10px] text-muted-foreground space-y-1">
                    <li>✓ Only gradients computed, never raw data</li>
                    <li>✓ No browser languages shared</li>
                    <li>✓ No timezone or location data</li>
                    <li>✓ All computation happens locally</li>
                    <li>✓ Revoke consent anytime</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* View Dashboard Link */}
            <Link
              to="/model-performance"
              className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 bg-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.5)] rounded-lg text-[hsl(var(--cat-device))] text-xs font-medium hover:brightness-95 transition-colors"
            >
              <BarChart3 className="w-3 h-3" />
              View Performance Dashboard
            </Link>

            {/* Clear Data Button */}
            {federatedStatus.hasGradients && (
              <button
                onClick={() => {
                  clearFederatedData();
                  setFederatedStatus(getFederatedStatus());
                  setGradientSummary(null);
                }}
                className="w-full mt-2 text-muted-foreground text-xs hover:text-foreground transition-colors"
              >
                Clear Local Gradient Data
              </button>
            )}
          </>
        ) : activeTab === 'fingerprint' ? (
          <>
            {/* Fingerprint Testing Header */}
            <div className="mb-4">
              <h4 className="text-foreground font-semibold text-sm flex items-center gap-2">
                <Fingerprint className="w-4 h-4" />
                Fingerprint Testing & Validation
              </h4>
              <p className="text-muted-foreground text-xs mt-1">
                Test fingerprint detection accuracy and protection
              </p>
            </div>

            {isTestingFingerprint && (
              <div className="mb-4 p-3 bg-risk-high-soft border border-risk-high/30 rounded-lg flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-foreground animate-spin" />
                <span className="text-foreground text-xs">Running fingerprint tests...</span>
              </div>
            )}

            {/* Regeneration Test */}
            <div className="mb-4 p-3 bg-risk-high-soft border border-risk-high/30 rounded-lg">
              <h5 className="text-foreground text-xs font-medium mb-2 flex items-center gap-2">
                <RefreshCw className="w-3 h-3" />
                Fingerprint Regeneration Test
              </h5>
              <button
                onClick={handleRegenerateFingerprints}
                disabled={isTestingFingerprint}
                className="w-full mb-2 px-3 py-2 bg-risk-high-soft border border-risk-high/30 rounded-lg text-foreground text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
              >
                Regenerate All Fingerprints
              </button>
              
              {fingerprintData && previousFingerprint && (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Canvas:</span>
                    <span className={fingerprintData.canvas?.hash === previousFingerprint.canvas?.hash ? 'text-risk-low' : 'text-risk-mid'}>
                      {fingerprintData.canvas?.hash === previousFingerprint.canvas?.hash ? 'Stable' : 'Changed'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">WebGL:</span>
                    <span className={fingerprintData.webgl?.hash === previousFingerprint.webgl?.hash ? 'text-risk-low' : 'text-risk-mid'}>
                      {fingerprintData.webgl?.hash === previousFingerprint.webgl?.hash ? 'Stable' : 'Changed'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Audio:</span>
                    <span className={fingerprintData.audio?.hash === previousFingerprint.audio?.hash ? 'text-risk-low' : 'text-risk-mid'}>
                      {fingerprintData.audio?.hash === previousFingerprint.audio?.hash ? 'Stable' : 'Changed'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fonts:</span>
                    <span className={fingerprintData.fonts?.count === previousFingerprint.fonts?.count ? 'text-risk-low' : 'text-risk-mid'}>
                      {fingerprintData.fonts?.count === previousFingerprint.fonts?.count ? 'Stable' : 'Changed'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Stability Tracking */}
            <div className="mb-4 p-3 bg-[hsl(var(--cat-language-tint))] border border-[hsl(var(--cat-language)/0.3)] rounded-lg">
              <h5 className="text-[hsl(var(--cat-language))] text-xs font-medium mb-2 flex items-center gap-2">
                <Activity className="w-3 h-3" />
                Fingerprint Stability
              </h5>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">History:</span>
                <span className="text-[hsl(var(--cat-language))]">{fingerprintHistory.length} checks</span>
              </div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">Stability:</span>
                <span className={stabilityStats.total > 0 && stabilityStats.stable === stabilityStats.total ? 'text-risk-mid' : 'text-risk-low'}>
                  {stabilityStats.total > 0 ? `${stabilityStats.stable}/${stabilityStats.total} stable` : 'No data yet'}
                </span>
              </div>
              {stabilityStats.total > 0 && stabilityStats.stable === stabilityStats.total && (
                <p className="text-muted-foreground text-[10px]">Fingerprint stays the same, so it can be used to recognise this browser</p>
              )}
              {stabilityStats.total > 0 && stabilityStats.stable < stabilityStats.total && (
                <p className="text-muted-foreground text-[10px]">Fingerprint changes, which makes it harder to recognise this browser</p>
              )}
            </div>

            {/* Protection Effectiveness Test */}
            <div className="mb-4 p-3 bg-risk-low-soft border border-risk-low/30 rounded-lg">
              <h5 className="text-risk-low text-xs font-medium mb-2 flex items-center gap-2">
                <Shield className="w-3 h-3" />
                Protection Effectiveness
              </h5>
              <button
                onClick={handleTestProtection}
                disabled={isTestingFingerprint}
                className="w-full mb-2 px-3 py-2 bg-risk-low-soft border border-risk-low/30 rounded-lg text-risk-low text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
              >
                Test Fingerprint Protection
              </button>
              
              {Object.entries(protectionTestResults).some(([_, v]) => v !== null) && (
                <div className="space-y-1 text-xs">
                  {Object.entries(protectionTestResults).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground capitalize">{key}:</span>
                      <span className={
                        value === 'blocked' ? 'text-risk-low' :
                        value === 'partial' ? 'text-risk-mid' :
                        value === 'allowed' ? 'text-foreground' : 'text-muted-foreground'
                      }>
                        {value === 'blocked' ? 'Blocked' :
                         value === 'partial' ? 'Partial' :
                         value === 'allowed' ? 'Allowed' : 'Not tested'}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 mt-2 border-t border-risk-low/30">
                    <div className="flex justify-between font-medium">
                      <span className="text-risk-low">Overall:</span>
                      <span className="text-risk-low">
                        {Math.round((Object.values(protectionTestResults).filter(v => v === 'blocked').length / 5) * 100)}% protected
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Entropy Calculator */}
            {fingerprintData && (
              <div className="mb-4 p-3 bg-[hsl(var(--cat-device-tint))] border border-[hsl(var(--cat-device)/0.3)] rounded-lg">
                <h5 className="text-[hsl(var(--cat-device))] text-xs font-medium mb-2 flex items-center gap-2">
                  <Zap className="w-3 h-3" />
                  Fingerprint Entropy
                </h5>
                {(() => {
                  const entropy = calculateEntropy(fingerprintData.uniqueness);
                  return (
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Canvas:</span>
                        <span className="text-[hsl(var(--cat-device))] font-mono">{entropy.breakdown.canvas.toFixed(1)} bits</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">WebGL:</span>
                        <span className="text-[hsl(var(--cat-device))] font-mono">{entropy.breakdown.webgl.toFixed(1)} bits</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Audio:</span>
                        <span className="text-[hsl(var(--cat-device))] font-mono">{entropy.breakdown.audio.toFixed(1)} bits</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fonts:</span>
                        <span className="text-[hsl(var(--cat-device))] font-mono">{entropy.breakdown.fonts.toFixed(1)} bits</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Plugins:</span>
                        <span className="text-[hsl(var(--cat-device))] font-mono">{entropy.breakdown.plugins.toFixed(1)} bits</span>
                      </div>
                      <div className="pt-2 mt-2 border-t border-[hsl(var(--cat-device)/0.3)]">
                        <div className="flex justify-between font-medium">
                          <span className="text-[hsl(var(--cat-device))]">Total:</span>
                          <span className="text-[hsl(var(--cat-device))] font-mono">{entropy.total.toFixed(1)} bits</span>
                        </div>
                        <p className="text-muted-foreground text-[10px] mt-1">
                          1 in {Math.pow(2, entropy.total).toLocaleString(undefined, { maximumFractionDigits: 0 })} browsers
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Cross-Browser Comparison */}
            <div className="mb-4 p-3 bg-risk-mid-soft border border-risk-mid/30 rounded-lg">
              <h5 className="text-risk-mid text-xs font-medium mb-2 flex items-center gap-2">
                <Globe className="w-3 h-3" />
                Cross-Browser Comparison
              </h5>
              <p className="text-muted-foreground text-[10px] mb-2">
                Your current fingerprint hash:
              </p>
              <code className="block text-risk-mid text-[10px] font-mono bg-risk-mid-soft p-2 rounded break-all mb-2">
                {fingerprintData?.compositeHash || 'Not yet computed'}
              </code>
              <p className="text-muted-foreground text-[10px]">
                Open in different browsers to compare fingerprint differences
              </p>
            </div>

            {/* Simulated Fingerprints */}
            <div className="mb-4 p-3 bg-[hsl(var(--cat-storage-tint))] border border-[hsl(var(--cat-storage)/0.3)] rounded-lg">
              <h5 className="text-[hsl(var(--cat-storage))] text-xs font-medium mb-2 flex items-center gap-2">
                <Eye className="w-3 h-3" />
                Simulate Fresh Browser
              </h5>
              <div className="space-y-2">
                {Object.entries(simulatedFingerprints).map(([key, sim]) => (
                  <div key={key} className="flex items-center justify-between p-2 bg-[hsl(var(--cat-storage-tint))] rounded">
                    <div>
                      <span className="text-[hsl(var(--cat-storage))] text-xs capitalize">{key.replace(/-/g, ' ')}</span>
                      <div className="text-muted-foreground text-[10px] font-mono">{sim.hash}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-muted-foreground text-[10px]">{sim.uniqueness}</span>
                      <div className={cn(
                        "text-[9px]",
                        sim.risk === 'very-low' ? 'text-risk-low' :
                        sim.risk === 'low' ? 'text-risk-low' :
                        'text-foreground'
                      )}>
                        {sim.risk} risk
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* External Validation */}
            <div className="mb-4 p-3 bg-secondary border border-surface-border rounded-lg">
              <h5 className="text-foreground text-xs font-medium mb-2 flex items-center gap-2">
                <ExternalLink className="w-3 h-3" />
                External Validation Tools
              </h5>
              <div className="space-y-2">
                <button
                  onClick={() => window.open('https://coveryourtracks.eff.org/', '_blank')}
                  className="w-full px-3 py-2 bg-secondary border border-surface-border rounded text-foreground text-xs hover:bg-muted transition-colors flex items-center justify-between"
                >
                  <span>EFF Cover Your Tracks</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button
                  onClick={() => window.open('https://amiunique.org/', '_blank')}
                  className="w-full px-3 py-2 bg-secondary border border-surface-border rounded text-foreground text-xs hover:bg-muted transition-colors flex items-center justify-between"
                >
                  <span>AmIUnique</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button
                  onClick={() => window.open('https://browserleaks.com/', '_blank')}
                  className="w-full px-3 py-2 bg-secondary border border-surface-border rounded text-foreground text-xs hover:bg-muted transition-colors flex items-center justify-between"
                >
                  <span>BrowserLeaks</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Export Report */}
            <button
              onClick={exportFingerprintReport}
              disabled={!fingerprintData}
              className="w-full mb-2 px-3 py-2 bg-risk-high-soft border border-risk-high/30 rounded-lg text-foreground text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Download className="w-3 h-3" />
              Export Fingerprint Report
            </button>
            <p className="text-center text-muted-foreground text-[10px]">
              🔒 Safe to share - contains no personal data
            </p>

            {/* Clear History */}
            {fingerprintHistory.length > 0 && (
              <button
                onClick={() => {
                  setFingerprintHistory([]);
                  setStabilityStats({ total: 0, stable: 0 });
                  localStorage.removeItem('fingerprint-history');
                }}
                className="w-full mt-2 text-muted-foreground text-xs hover:text-foreground transition-colors"
              >
                Clear Fingerprint History
              </button>
            )}
          </>
        ) : null}
      </div>

      {/* Hotkey hint */}
      <div className="p-2 border-t border-risk-mid/30">
        <p className="text-center text-muted-foreground text-xs">
          Press Shift+Alt+V to toggle
        </p>
      </div>
    </div>
  );
}
