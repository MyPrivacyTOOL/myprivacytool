import { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, CheckCircle2, Bug, Globe, Play, Check, TrendingUp, Users, Gift, Trash2, Download, AlertTriangle, Clock, ThumbsUp, ThumbsDown, ArrowUpDown, Lock, Database, FileJson } from 'lucide-react';
import { getVoiceData, resetDailyCounter, resetAllVoiceData } from '@/lib/voiceStorage';
import { cn } from '@/lib/utils';
import { 
  predictLanguagePreference, 
  initializeModel,
  getAccuracyStats,
  getContributionCount,
  getTotalPredictions,
  type LanguagePrediction,
  type LanguageAnalysis,
} from '@/lib/languagePredictor';
import { getRewardStats, clearRewards, getAllRewards, type RewardStats, type RewardEvent } from '@/lib/rewardTracking';
import { generateSyntheticData, exportToJSON, getDataStats, validateExamples, type SyntheticExample } from '@/lib/syntheticDataGenerator';
import { testScenarios, createMockAnalysis } from '@/lib/testScenarios';
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
  const [activeTab, setActiveTab] = useState<'voice' | 'locale' | 'rewards'>('voice');
  const [testResults, setTestResults] = useState<Map<string, { prediction: LanguagePrediction | null; passed: boolean }>>(new Map());
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [rewardEvents, setRewardEvents] = useState<RewardEvent[]>([]);
  const [syntheticData, setSyntheticData] = useState<SyntheticExample[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Refresh data
  const refreshData = useCallback(() => {
    setData(getVoiceData());
    setRewardEvents(getAllRewards().slice(-10).reverse());
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
        className="fixed bottom-4 right-4 z-50 p-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-400 hover:bg-yellow-500/30 transition-colors"
        title="Open Voice Debug Panel (Shift+Alt+V)"
      >
        <Bug className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 bg-black/95 border border-yellow-500/50 rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.3)] max-h-[80vh] overflow-hidden flex flex-col">
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
