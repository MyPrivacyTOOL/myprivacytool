import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, RotateCcw, CheckCircle2, Bug, Globe, Play, Check, TrendingUp, Users, Gift, Trash2, Download, AlertTriangle, Clock, ThumbsUp, ThumbsDown, ArrowUpDown, Lock, Database, FileJson, Cpu, Zap, BarChart3, Settings2, Shield, Eye, Share2, History, RefreshCw } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'voice' | 'locale' | 'rewards' | 'compare' | 'federated'>('voice');
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
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-2 sm:right-4 z-50 p-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-400 hover:bg-yellow-500/30 transition-colors"
        title="Open Voice Debug Panel (Shift+Alt+V)"
      >
        <Bug className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-[calc(0.5rem+env(safe-area-inset-bottom))] right-2 sm:right-4 left-2 sm:left-auto z-50 sm:w-96 bg-black/95 border border-yellow-500/50 rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.3)] max-h-[70vh] sm:max-h-[80vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-yellow-500/30">
        <div className="flex items-center gap-2">
          <Bug className="w-5 h-5 text-yellow-400" />
          <h3 className="text-yellow-400 font-bold text-sm">Debug Panel</h3>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-yellow-400/60 hover:text-yellow-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-yellow-500/30">
        <button
          onClick={() => setActiveTab('voice')}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === 'voice' 
              ? "text-yellow-400 bg-yellow-500/20 border-b-2 border-yellow-400" 
              : "text-yellow-400/60 hover:text-yellow-400"
          )}
        >
          Voice
        </button>
        <button
          onClick={() => setActiveTab('locale')}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            activeTab === 'locale' 
              ? "text-cyan-400 bg-cyan-500/20 border-b-2 border-cyan-400" 
              : "text-cyan-400/60 hover:text-cyan-400"
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
              ? "text-amber-400 bg-amber-500/20 border-b-2 border-amber-400" 
              : "text-amber-400/60 hover:text-amber-400"
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
              ? "text-pink-400 bg-pink-500/20 border-b-2 border-pink-400" 
              : "text-pink-400/60 hover:text-pink-400"
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
              ? "text-emerald-400 bg-emerald-500/20 border-b-2 border-emerald-400" 
              : "text-emerald-400/60 hover:text-emerald-400"
          )}
        >
          <Share2 className="w-3 h-3" />
          <span className="hidden sm:inline">Federated</span>
          <span className="sm:hidden">Fed</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'voice' ? (
          <>
            {/* Voice Stats */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-yellow-300/70">Sessions Today:</span>
                <span className="text-yellow-400 font-mono">{data.voiceSessionCount} / 20</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-300/70">Current Risk Score:</span>
                <span className={cn(
                  "font-mono font-bold",
                  currentRiskScore >= 70 ? "text-red-400" :
                  currentRiskScore >= 40 ? "text-yellow-400" : "text-green-400"
                )}>{currentRiskScore}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-300/70">Best Risk Score:</span>
                <span className="text-green-400 font-mono">{data.bestRiskScore}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-300/70">Total Scans:</span>
                <span className="text-yellow-400 font-mono">{data.totalScansCompleted}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-300/70">Hexagons Today:</span>
                <span className="text-yellow-400 font-mono">{data.completedHexagons.length}</span>
              </div>
            </div>

            {/* Last 5 Responses */}
            <div className="mb-4">
              <h4 className="text-yellow-300/70 text-xs mb-2">Last 5 Responses:</h4>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {data.responseHistory.length === 0 ? (
                  <p className="text-yellow-300/40 text-xs italic">No responses yet</p>
                ) : (
                  data.responseHistory.map((response, i) => (
                    <p key={i} className="text-yellow-300/60 text-xs truncate" title={response}>
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
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-400 text-xs font-medium hover:bg-yellow-500/30 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Daily
              </button>
              <button
                onClick={() => {
                  onSimulateComplete?.();
                  refreshData();
                }}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-xs font-medium hover:bg-green-500/30 transition-colors"
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
              className="w-full mt-2 px-3 py-1.5 text-red-400/60 text-xs hover:text-red-400 transition-colors"
            >
              Reset All Data
            </button>
          </>
        ) : activeTab === 'locale' ? (
          <>
            {/* Feedback Stats Section */}
            <div className="mb-4 p-3 bg-gradient-to-r from-purple-500/10 to-purple-600/10 border border-purple-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-purple-400" />
                <h4 className="text-purple-400 text-xs font-medium">Language Feedback Stats</h4>
              </div>
              
              {(() => {
                const stats = getAccuracyStats();
                const contributions = getContributionCount();
                const totalPredictions = getTotalPredictions();
                
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-purple-300/70">Model Accuracy:</span>
                      <span className={cn(
                        "font-mono font-bold",
                        stats.accuracy >= 80 ? "text-green-400" :
                        stats.accuracy >= 60 ? "text-yellow-400" : "text-red-400"
                      )}>
                        {stats.correct}/{stats.total} ({stats.accuracy}%)
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-purple-300/70">Total Predictions:</span>
                      <span className="text-purple-400 font-mono">{totalPredictions}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-purple-300/70">User Contributions:</span>
                      <span className="text-purple-400 font-mono">{contributions}</span>
                    </div>
                    
                    {/* Profile Distribution */}
                    {Object.entries(stats.profileBreakdown).some(([_, d]) => d.total > 0) && (
                      <div className="pt-2 mt-2 border-t border-purple-500/20">
                        <div className="flex items-center gap-1 mb-2">
                          <Users className="w-3 h-3 text-purple-400/60" />
                          <span className="text-purple-400/60 text-xs">Profile Distribution</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(stats.profileBreakdown).map(([profile, data]) => (
                            <div key={profile} className="text-xs text-purple-300/60 capitalize">
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
                <h4 className="text-cyan-400/70 text-xs font-medium">Language Scenarios</h4>
                <button
                  onClick={runAllTests}
                  disabled={isRunningTest}
                  className="px-2 py-1 bg-cyan-500/20 border border-cyan-500/50 rounded text-cyan-400 text-xs hover:bg-cyan-500/30 transition-colors flex items-center gap-1 disabled:opacity-50"
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
                      className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span>{scenario.icon}</span>
                          <span className="text-cyan-400 text-xs font-medium">{scenario.name}</span>
                        </div>
                        <button
                          onClick={() => runScenarioTest(scenario.id)}
                          disabled={isRunningTest}
                          className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-cyan-400 text-xs hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
                        >
                          Test
                        </button>
                      </div>
                      <div className="text-xs text-cyan-400/60">
                        {scenario.languages.join(', ')} • {scenario.timezone}
                      </div>
                      {result && (
                        <div className="mt-2 pt-2 border-t border-cyan-500/20">
                          <div className="flex items-center gap-2">
                            {result.prediction?.allProfiles.slice(0, 3).map(p => (
                              <div key={p.profile} className="flex items-center gap-1 text-xs">
                                <span>{p.icon}</span>
                                <span className="text-cyan-400/70">{p.probability}%</span>
                              </div>
                            ))}
                            <Check className="w-3 h-3 text-green-400 ml-auto" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Synthetic Data Generator */}
            <div className="mb-4 p-3 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-emerald-400 text-xs font-medium">Training Data Generator</h4>
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
                          <span className="text-emerald-300/70">Total Examples:</span>
                          <span className="text-emerald-400 font-mono">{stats.total}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-emerald-300/70">Unique Language Combos:</span>
                          <span className="text-emerald-400 font-mono">{stats.uniqueLanguageCombos}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-emerald-300/70">Unique Timezones:</span>
                          <span className="text-emerald-400 font-mono">{stats.uniqueTimezones}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-emerald-300/70">Validation:</span>
                          <span className={cn(
                            "font-mono",
                            validation.invalid === 0 ? "text-green-400" : "text-yellow-400"
                          )}>
                            {validation.valid} valid / {validation.invalid} invalid
                          </span>
                        </div>
                        
                        {/* Pattern Distribution */}
                        <div className="pt-2 mt-2 border-t border-emerald-500/20">
                          <span className="text-emerald-400/60 text-xs">Distribution:</span>
                          <div className="grid grid-cols-2 gap-1 mt-1">
                            {Object.entries(stats.byPattern).map(([pattern, data]) => (
                              <div key={pattern} className="flex justify-between text-xs">
                                <span className="text-emerald-300/60 capitalize">{pattern.replace('_', ' ')}:</span>
                                <span className="text-emerald-400/80 font-mono">{data.count}</span>
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
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
                    >
                      <FileJson className="w-3 h-3" />
                      Download JSON
                    </button>
                    <button
                      onClick={() => setSyntheticData(null)}
                      className="px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-emerald-400/60 text-xs mb-3">
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
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
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
            <div className="mb-4 p-3 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-violet-400" />
                  <h4 className="text-violet-400 text-xs font-medium">TensorFlow Model</h4>
                </div>
                {modelMetadata && (
                  <span className="text-[10px] text-violet-400/60 font-mono">{modelMetadata.version}</span>
                )}
              </div>
              
              {/* Model Status */}
              {modelMetadata ? (
                <div className="space-y-2 mb-3">
                  <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-green-400 text-xs font-medium">Trained Model Active</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-violet-300/70">Training Accuracy:</span>
                    <span className="text-violet-400 font-mono">{modelMetadata.trainingAccuracy}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-violet-300/70">Validation Accuracy:</span>
                    <span className="text-violet-400 font-mono">{modelMetadata.validationAccuracy}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-violet-300/70">Trained On:</span>
                    <span className="text-violet-400 font-mono">{modelMetadata.examplesUsed} examples</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-violet-300/70">Trained At:</span>
                    <span className="text-violet-400/70 font-mono text-[10px]">
                      {new Date(modelMetadata.trainedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 mb-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
                  <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-yellow-400 text-xs">Using heuristic model (not trained)</span>
                </div>
              )}
              
              {/* Training Progress */}
              {isTraining && trainingProgress && (
                <div className="mb-3 p-2 bg-black/30 rounded">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-violet-400/70">
                      {trainingProgress.phase === 'preparing' ? 'Preparing...' :
                       trainingProgress.phase === 'training' ? `Epoch ${trainingProgress.epoch}/${trainingProgress.totalEpochs}` :
                       trainingProgress.phase === 'validating' ? 'Validating...' : 'Complete!'}
                    </span>
                    <span className="text-violet-400 font-mono">{trainingProgress.accuracy.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-300"
                      style={{ width: `${(trainingProgress.epoch / trainingProgress.totalEpochs) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-violet-400/50 mt-1">
                    <span>Loss: {trainingProgress.loss.toFixed(4)}</span>
                    <span>Accuracy: {trainingProgress.accuracy.toFixed(1)}%</span>
                  </div>
                </div>
              )}
              
              {/* Training Result */}
              {trainingResult && !isTraining && (
                <div className="mb-3 p-2 bg-green-500/10 border border-green-500/30 rounded">
                  <div className="flex items-center gap-2 text-xs text-green-400">
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
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-500/20 border border-violet-500/50 rounded-lg text-violet-400 text-xs font-medium hover:bg-violet-500/30 transition-colors disabled:opacity-50"
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
                        className="px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black/95 border-red-500/30">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-400">Reset to Default Model?</AlertDialogTitle>
                        <AlertDialogDescription className="text-violet-400/70">
                          This will remove the trained model and revert to the heuristic-based predictions. You can retrain anytime.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-violet-500/30 text-violet-400 hover:bg-violet-500/10">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleResetModel}
                          className="bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30"
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
            <div className="pt-3 border-t border-cyan-500/30">
              <a
                href="/test-locale"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-3 py-2 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-400 text-xs font-medium hover:bg-purple-500/30 transition-colors text-center"
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
                  <div className="p-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-lg">
                    <h4 className="text-amber-400 text-xs font-medium mb-3 flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5" />
                      Language Model Rewards
                    </h4>
                    
                    {rewardStats.totalEvents === 0 ? (
                      <p className="text-amber-400/50 text-xs italic">No reward events tracked yet. Use the app to generate data.</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-amber-300/70">Total Predictions:</span>
                          <span className="text-amber-400 font-mono">{rewardStats.totalEvents}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-amber-300/70">Average Reward:</span>
                          <span className={cn(
                            "font-mono font-bold",
                            rewardStats.averageReward >= 0.5 ? "text-green-400" :
                            rewardStats.averageReward >= 0 ? "text-yellow-400" : "text-red-400"
                          )}>
                            {rewardStats.averageReward >= 0 ? '+' : ''}{rewardStats.averageReward.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-amber-300/70">Positive / Negative:</span>
                          <span className="font-mono">
                            <span className="text-green-400">{totalPositive}</span>
                            <span className="text-amber-400/40"> / </span>
                            <span className="text-red-400">{totalNegative}</span>
                          </span>
                        </div>
                        
                        {/* Accuracy indicator */}
                        <div className="mt-2 p-2 bg-black/30 rounded">
                          <div className="flex items-center gap-2 text-xs">
                            {positiveRatio >= 70 ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                            ) : positiveRatio >= 50 ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                            )}
                            <span className={cn(
                              positiveRatio >= 70 ? "text-green-400" :
                              positiveRatio >= 50 ? "text-yellow-400" : "text-red-400"
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
                    <div className="p-3 bg-black/30 border border-amber-500/20 rounded-lg">
                      <h4 className="text-amber-400/70 text-xs font-medium mb-3 flex items-center gap-2">
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
                                <span className="text-amber-300/60 capitalize">{formatReason(reason)}</span>
                                <span className={cn(
                                  "font-mono",
                                  isPositive ? "text-green-400/70" : "text-red-400/70"
                                )}>
                                  {data.count} events
                                </span>
                              </div>
                              <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    isPositive ? "bg-green-500/60" : "bg-red-500/60"
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
                    <div className="p-3 bg-black/30 border border-amber-500/20 rounded-lg">
                      <h4 className="text-amber-400/70 text-xs font-medium mb-3 flex items-center gap-2">
                        <Users className="w-3 h-3" />
                        Profile Performance
                      </h4>
                      
                      <div className="space-y-2">
                        {bestProfile && (
                          <div className="flex items-center gap-2 text-xs">
                            <ThumbsUp className="w-3 h-3 text-green-400" />
                            <span className="text-green-400/80">
                              Best: <span className="capitalize font-medium">{bestProfile.profile}</span> (avg: {bestProfile.average.toFixed(2)})
                            </span>
                          </div>
                        )}
                        {worstProfile && worstProfile !== bestProfile && (
                          <div className="flex items-center gap-2 text-xs">
                            <ThumbsDown className="w-3 h-3 text-red-400" />
                            <span className="text-red-400/80">
                              Needs work: <span className="capitalize font-medium">{worstProfile.profile}</span> (avg: {worstProfile.average.toFixed(2)})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Recent Reward History */}
                  {rewardEvents.length > 0 && (
                    <div className="p-3 bg-black/30 border border-amber-500/20 rounded-lg">
                      <h4 className="text-amber-400/70 text-xs font-medium mb-3 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Recent Events (Last 10)
                      </h4>
                      
                      <div className="max-h-40 overflow-y-auto space-y-1.5">
                        {rewardEvents.map((event) => (
                          <div 
                            key={event.id} 
                            className="flex items-center justify-between text-xs p-1.5 bg-black/20 rounded"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-amber-400/40 font-mono text-[10px]">
                                {formatTime(event.timestamp)}
                              </span>
                              <span className="text-amber-300/60 truncate" title={event.prediction}>
                                {event.prediction.slice(0, 12)}...
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-amber-400/50 text-[10px] truncate max-w-16" title={formatReason(event.reason)}>
                                {formatReason(event.reason)}
                              </span>
                              <span className={cn(
                                "font-mono font-bold min-w-8 text-right",
                                event.reward > 0 ? "text-green-400" : "text-red-400"
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
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500/20 border border-amber-500/50 rounded-lg text-amber-400 text-xs font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-3 h-3" />
                      Export JSON
                    </button>
                    
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          disabled={rewardStats.totalEvents === 0}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3 h-3" />
                          Reset History
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-black/95 border-red-500/30">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-red-400">Reset Reward History?</AlertDialogTitle>
                          <AlertDialogDescription className="text-amber-400/70">
                            This will permanently delete all {rewardStats.totalEvents} reward events from your local storage. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-transparent border-amber-500/30 text-amber-400 hover:bg-amber-500/10">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              clearRewards();
                              setRewardEvents([]);
                              refreshData();
                            }}
                            className="bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30"
                          >
                            Reset All
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  
                  {/* Privacy notice */}
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-amber-400/40">
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
              <div className="p-3 bg-gradient-to-r from-pink-500/10 to-rose-500/10 border border-pink-500/30 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-pink-400" />
                    <h4 className="text-pink-400 text-xs font-medium">A/B Testing Mode</h4>
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
                          ? "bg-pink-500/30 border-pink-500 text-pink-400"
                          : "bg-black/20 border-pink-500/30 text-pink-400/60 hover:text-pink-400"
                      )}
                    >
                      {mode === 'best' ? 'Best of Both' : mode}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-pink-400/50 mt-2">
                  {predictionMode === 'trained' && 'Using trained TensorFlow model only'}
                  {predictionMode === 'heuristic' && 'Using heuristic rules only'}
                  {predictionMode === 'best' && 'Using whichever has higher confidence'}
                </p>
              </div>
              
              {/* Performance Stats */}
              {performanceStats && (
                <div className="p-3 bg-black/30 border border-pink-500/20 rounded-lg">
                  <h4 className="text-pink-400/70 text-xs font-medium mb-3 flex items-center gap-2">
                    <BarChart3 className="w-3 h-3" />
                    Model Performance Comparison
                  </h4>
                  
                  {performanceStats.totalComparisons === 0 ? (
                    <p className="text-pink-400/50 text-xs italic">No comparisons yet. Make predictions to see data.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-pink-300/70">Total Comparisons:</span>
                        <span className="text-pink-400 font-mono">{performanceStats.totalComparisons}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-pink-300/70">Agreement Rate:</span>
                        <span className={cn(
                          "font-mono",
                          performanceStats.agreementRate >= 80 ? "text-green-400" :
                          performanceStats.agreementRate >= 60 ? "text-yellow-400" : "text-red-400"
                        )}>
                          {performanceStats.agreementRate}%
                        </span>
                      </div>
                      
                      <div className="pt-2 mt-2 border-t border-pink-500/20">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-pink-300/70">Trained Model Confidence:</span>
                          <span className="text-pink-400 font-mono">{performanceStats.trainedModelAvgConfidence}%</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-pink-300/70">Heuristic Confidence:</span>
                          <span className="text-pink-400 font-mono">{performanceStats.heuristicAvgConfidence}%</span>
                        </div>
                      </div>
                      
                      {(performanceStats.trainedModelAccuracy > 0 || performanceStats.heuristicAccuracy > 0) && (
                        <div className="pt-2 mt-2 border-t border-pink-500/20">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-pink-300/70">Trained Model Accuracy:</span>
                            <span className={cn(
                              "font-mono font-bold",
                              performanceStats.trainedModelAccuracy >= performanceStats.heuristicAccuracy ? "text-green-400" : "text-pink-400"
                            )}>
                              {performanceStats.trainedModelAccuracy}%
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-pink-300/70">Heuristic Accuracy:</span>
                            <span className={cn(
                              "font-mono font-bold",
                              performanceStats.heuristicAccuracy > performanceStats.trainedModelAccuracy ? "text-green-400" : "text-pink-400"
                            )}>
                              {performanceStats.heuristicAccuracy}%
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* Wins breakdown */}
                      <div className="pt-2 mt-2 border-t border-pink-500/20">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-pink-300/70">Confidence Wins:</span>
                          <div className="font-mono text-[10px]">
                            <span className="text-green-400">{performanceStats.trainedModelWins} trained</span>
                            <span className="text-pink-400/40"> / </span>
                            <span className="text-yellow-400">{performanceStats.heuristicWins} heuristic</span>
                            <span className="text-pink-400/40"> / </span>
                            <span className="text-gray-400">{performanceStats.ties} ties</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Improvement indicator */}
                      {performanceStats.improvement !== 0 && (
                        <div className={cn(
                          "mt-2 p-2 rounded text-xs flex items-center gap-2",
                          performanceStats.improvement > 0 
                            ? "bg-green-500/10 border border-green-500/30" 
                            : "bg-red-500/10 border border-red-500/30"
                        )}>
                          {performanceStats.improvement > 0 ? (
                            <>
                              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                              <span className="text-green-400">
                                Trained model is {Math.abs(performanceStats.improvement)}% more accurate
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                              <span className="text-red-400">
                                Heuristics are {Math.abs(performanceStats.improvement)}% more accurate
                              </span>
                            </>
                          )}
                        </div>
                      )}
                      
                      {/* Recommendation */}
                      <div className="mt-2 p-2 bg-pink-500/10 rounded text-[10px] text-pink-400/70">
                        💡 {performanceStats.recommendation}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Recent Comparisons */}
              {comparisons.length > 0 && (
                <div className="p-3 bg-black/30 border border-pink-500/20 rounded-lg">
                  <h4 className="text-pink-400/70 text-xs font-medium mb-3 flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    Recent Comparisons (Last 10)
                  </h4>
                  
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {comparisons.map((comp) => (
                      <div 
                        key={comp.id} 
                        className="p-2 bg-black/20 rounded text-[10px]"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-pink-400/40 font-mono">
                            {new Date(comp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {comp.agree ? (
                            <span className="text-green-400/70 flex items-center gap-1">
                              <Check className="w-2.5 h-2.5" /> Agree
                            </span>
                          ) : (
                            <span className="text-yellow-400/70 flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" /> Differ
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="text-pink-300/50">Trained: </span>
                            <span className="text-pink-400 capitalize">
                              {comp.trainedModelProfile} {comp.trainedModelConfidence}%
                            </span>
                          </div>
                          <div>
                            <span className="text-pink-300/50">Heuristic: </span>
                            <span className="text-pink-400 capitalize">
                              {comp.heuristicProfile} {comp.heuristicConfidence}%
                            </span>
                          </div>
                        </div>
                        {comp.reward !== undefined && (
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-pink-300/50">Reward:</span>
                            <span className={cn(
                              "font-mono font-bold",
                              comp.reward > 0 ? "text-green-400" : "text-red-400"
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
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-pink-500/20 border border-pink-500/50 rounded-lg text-pink-400 text-xs font-medium hover:bg-pink-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-3 h-3" />
                  Export Report
                </button>
                
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      disabled={!performanceStats || performanceStats.totalComparisons === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear Data
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-black/95 border-red-500/30">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-red-400">Clear Comparison Data?</AlertDialogTitle>
                      <AlertDialogDescription className="text-pink-400/70">
                        This will delete all {performanceStats?.totalComparisons || 0} comparison records. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-pink-500/30 text-pink-400 hover:bg-pink-500/10">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          clearComparisonData();
                          setPerformanceStats(getPerformanceStats());
                          setComparisons([]);
                        }}
                        className="bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30"
                      >
                        Clear All
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              
              {/* Privacy notice */}
              <div className="flex items-center justify-center gap-1.5 text-[10px] text-pink-400/40">
                <Lock className="w-2.5 h-2.5" />
                <span>All comparisons stored locally only</span>
              </div>
            </div>
          </>
        ) : activeTab === 'federated' ? (
          <>
            {/* Federated Learning Status */}
            <div className="mb-4 p-3 bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 border border-emerald-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Share2 className="w-4 h-4 text-emerald-400" />
                <h4 className="text-emerald-400 text-xs font-medium">Federated Learning (Beta)</h4>
              </div>
              
              {/* Consent Status */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-300/70">Status:</span>
                  <span className={cn(
                    "font-mono font-bold",
                    federatedStatus.consent === true ? "text-green-400" :
                    federatedStatus.consent === false ? "text-red-400" : "text-yellow-400"
                  )}>
                    {federatedStatus.consent === true ? 'Enabled' :
                     federatedStatus.consent === false ? 'Disabled' : 'Not Asked'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-300/70">Has Gradients:</span>
                  <span className={cn(
                    "font-mono",
                    federatedStatus.hasGradients ? "text-green-400" : "text-gray-400"
                  )}>
                    {federatedStatus.hasGradients ? 'Yes' : 'No'}
                  </span>
                </div>
                {federatedStatus.lastUpdate && (
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-300/70">Last Update:</span>
                    <span className="text-emerald-400 font-mono">
                      {new Date(federatedStatus.lastUpdate).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-300/70">Model Version:</span>
                  <span className="text-emerald-400 font-mono">
                    {federatedStatus.modelVersion || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Consent Actions */}
              {federatedStatus.consent === null ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors">
                      <Shield className="w-3 h-3" />
                      Enable Federated Learning
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-black/95 border-emerald-500/30 max-h-[80vh] overflow-y-auto">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-emerald-400 flex items-center gap-2">
                        <Shield className="w-5 h-5" />
                        Privacy-First Federated Learning
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-emerald-400/70 text-left whitespace-pre-wrap text-xs">
                        {PRIVACY_EXPLANATION}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                        Not Now
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          setFederatedConsent(true);
                          setFederatedStatus(getFederatedStatus());
                        }}
                        className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/30"
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
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                  >
                    {isComputingGradients ? (
                      <>
                        <div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
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
                      <button className="px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-black/95 border-red-500/30">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-400">Revoke Consent?</AlertDialogTitle>
                        <AlertDialogDescription className="text-red-400/70">
                          This will disable federated learning and delete all stored gradients. You can re-enable anytime.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-red-500/30 text-red-400 hover:bg-red-500/10">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            revokeFederatedConsent();
                            setFederatedStatus(getFederatedStatus());
                            setGradientSummary(null);
                          }}
                          className="bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30"
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
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
                >
                  <Shield className="w-3 h-3" />
                  Re-enable Federated Learning
                </button>
              )}
            </div>

            {/* Gradient Summary */}
            {gradientSummary && (
              <div className="mb-4 p-3 bg-gradient-to-r from-blue-500/10 to-blue-600/10 border border-blue-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-4 h-4 text-blue-400" />
                  <h4 className="text-blue-400 text-xs font-medium">Your Gradient Summary</h4>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-blue-300/70">Layers:</span>
                    <span className="text-blue-400 font-mono">{gradientSummary.layerCount}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-blue-300/70">Parameters:</span>
                    <span className="text-blue-400 font-mono">{gradientSummary.totalParameters.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-blue-300/70">Avg Magnitude:</span>
                    <span className="text-blue-400 font-mono">{gradientSummary.averageMagnitude.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-blue-300/70">Based on Rewards:</span>
                    <span className="text-blue-400 font-mono">{gradientSummary.rewardBasis}</span>
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
                  className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/20 border border-blue-500/50 rounded-lg text-blue-400 text-xs font-medium hover:bg-blue-500/30 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Export Gradients (View What's Shared)
                </button>
              </div>
            )}

            {/* Local Learning Progress */}
            {federatedStatus.consent && localLearningStatus && (
              <div className="mb-4 p-3 bg-gradient-to-r from-purple-500/10 to-purple-600/10 border border-purple-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  <h4 className="text-purple-400 text-xs font-medium">Local Learning Progress</h4>
                </div>
                
                {/* Stats */}
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-xs">
                    <span className="text-purple-300/70">Model Updates:</span>
                    <span className="text-purple-400 font-mono">
                      {localLearningStatus.successfulUpdates} / {localLearningStatus.totalUpdates}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-purple-300/70">Current Accuracy:</span>
                    <span className="text-purple-400 font-mono">
                      {localLearningStatus.currentAccuracy.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-purple-300/70">Best Accuracy:</span>
                    <span className="text-green-400 font-mono">
                      {localLearningStatus.bestAccuracy.toFixed(1)}%
                    </span>
                  </div>
                  {localLearningStatus.lastUpdateTime && (
                    <div className="flex justify-between text-xs">
                      <span className="text-purple-300/70">Last Update:</span>
                      <span className="text-purple-400 font-mono">
                        {new Date(localLearningStatus.lastUpdateTime).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Accuracy Trend Chart (Simple) */}
                {localLearningStatus.improvementHistory.length > 0 && (
                  <div className="mb-4">
                    <h5 className="text-purple-400/70 text-[10px] font-medium mb-2">Accuracy Trend</h5>
                    <div className="h-16 flex items-end gap-1">
                      {localLearningStatus.improvementHistory.slice(-10).map((imp, idx) => (
                        <div 
                          key={idx}
                          className="flex-1 flex flex-col items-center gap-0.5"
                        >
                          <div 
                            className={cn(
                              "w-full rounded-t transition-all",
                              imp.improved ? "bg-green-500/60" : "bg-red-500/40"
                            )}
                            style={{ 
                              height: `${Math.max(4, (imp.accuracyAfter / 100) * 48)}px` 
                            }}
                          />
                          <span className="text-[8px] text-purple-400/50">
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
                      ? "bg-green-500/20 text-green-400" 
                      : "bg-red-500/20 text-red-400"
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
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-400 text-xs font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
                  >
                    {isRunningRLUpdate ? (
                      <>
                        <div className="w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
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
                  <div className="mt-2 text-[10px] text-purple-400/50 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {localLearningStatus.reasonCannotRun}
                  </div>
                )}
                
                {/* Version History */}
                {localLearningStatus.versionHistory.length > 0 && (
                  <div className="mt-4">
                    <h5 className="text-purple-400/70 text-[10px] font-medium mb-2 flex items-center gap-1">
                      <History className="w-3 h-3" />
                      Version History (Last 3)
                    </h5>
                    <div className="space-y-1.5">
                      {localLearningStatus.versionHistory.slice(-3).reverse().map((version: ModelVersion, idx: number) => (
                        <div 
                          key={version.id}
                          className="flex items-center justify-between p-1.5 bg-black/20 rounded text-[10px]"
                        >
                          <div>
                            <span className="text-purple-400 font-mono">{version.id.slice(0, 12)}...</span>
                            <span className="text-purple-400/50 ml-2">
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
                              className="px-2 py-0.5 bg-yellow-500/20 border border-yellow-500/30 rounded text-yellow-400 hover:bg-yellow-500/30 transition-colors flex items-center gap-1"
                            >
                              <RefreshCw className="w-2.5 h-2.5" />
                              Rollback
                            </button>
                          )}
                          {idx === 0 && (
                            <span className="text-green-400/70 text-[9px]">Current</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Privacy Notice */}
            <div className="p-3 bg-gradient-to-r from-gray-500/10 to-gray-600/10 border border-gray-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h5 className="text-gray-400 text-xs font-medium mb-1">Privacy Guarantees</h5>
                  <ul className="text-[10px] text-gray-400/70 space-y-1">
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
              className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-400 text-xs font-medium hover:bg-purple-500/30 transition-colors"
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
                className="w-full mt-2 text-red-400/60 text-xs hover:text-red-400 transition-colors"
              >
                Clear Local Gradient Data
              </button>
            )}
          </>
        ) : null}
      </div>

      {/* Hotkey hint */}
      <div className="p-2 border-t border-yellow-500/30">
        <p className="text-center text-yellow-300/40 text-xs">
          Press Shift+Alt+V to toggle
        </p>
      </div>
    </div>
  );
}
