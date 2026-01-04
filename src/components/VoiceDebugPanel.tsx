import { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, CheckCircle2, Bug, Globe, Play, Check, TrendingUp, Users, Gift, Trash2 } from 'lucide-react';
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
import { getRewardStats, clearRewards, type RewardStats } from '@/lib/rewardTracking';
import { testScenarios, createMockAnalysis } from '@/lib/testScenarios';

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

export default function VoiceDebugPanel({ currentRiskScore, onSimulateComplete }: VoiceDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState(getVoiceData());
  const [activeTab, setActiveTab] = useState<'voice' | 'locale'>('voice');
  const [testResults, setTestResults] = useState<Map<string, { prediction: LanguagePrediction | null; passed: boolean }>>(new Map());
  const [isRunningTest, setIsRunningTest] = useState(false);

  // Refresh data
  const refreshData = useCallback(() => {
    setData(getVoiceData());
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
            "flex-1 px-4 py-2 text-xs font-medium transition-colors",
            activeTab === 'voice' 
              ? "text-yellow-400 bg-yellow-500/20 border-b-2 border-yellow-400" 
              : "text-yellow-400/60 hover:text-yellow-400"
          )}
        >
          Voice Stats
        </button>
        <button
          onClick={() => setActiveTab('locale')}
          className={cn(
            "flex-1 px-4 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
            activeTab === 'locale' 
              ? "text-cyan-400 bg-cyan-500/20 border-b-2 border-cyan-400" 
              : "text-cyan-400/60 hover:text-cyan-400"
          )}
        >
          <Globe className="w-3 h-3" />
          Locale Tests
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
        ) : (
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

            {/* Implicit Reward Stats */}
            <div className="mb-4 p-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-amber-400" />
                  <h4 className="text-amber-400 text-xs font-medium">Implicit Reward Tracking</h4>
                </div>
                <button
                  onClick={() => {
                    clearRewards();
                    // Force re-render
                    setData(getVoiceData());
                  }}
                  className="p-1 text-amber-400/40 hover:text-amber-400 transition-colors"
                  title="Clear all rewards"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              
              {(() => {
                const rewardStats = getRewardStats();
                
                if (rewardStats.totalEvents === 0) {
                  return (
                    <p className="text-amber-400/50 text-xs italic">No reward events tracked yet</p>
                  );
                }
                
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-amber-300/70">Total Events:</span>
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
                        <span className="text-green-400">{rewardStats.positiveCount}</span>
                        <span className="text-amber-400/40"> / </span>
                        <span className="text-red-400">{rewardStats.negativeCount}</span>
                      </span>
                    </div>
                    
                    {/* Reward by Reason */}
                    {Object.keys(rewardStats.rewardByReason).length > 0 && (
                      <div className="pt-2 mt-2 border-t border-amber-500/20">
                        <span className="text-amber-400/60 text-xs">By Reason:</span>
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          {Object.entries(rewardStats.rewardByReason).slice(0, 6).map(([reason, data]) => (
                            <div key={reason} className="text-xs text-amber-300/50 truncate" title={reason}>
                              {reason.replace(/_/g, ' ')}: {data.count}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Trend (last few days) */}
                    {rewardStats.rewardTrend.length > 1 && (
                      <div className="pt-2 mt-2 border-t border-amber-500/20">
                        <span className="text-amber-400/60 text-xs">Daily Trend:</span>
                        <div className="mt-1 flex gap-1 h-8">
                          {rewardStats.rewardTrend.map((day, i) => {
                            const maxAvg = Math.max(...rewardStats.rewardTrend.map(d => Math.abs(d.avgReward)), 1);
                            const height = Math.max((Math.abs(day.avgReward) / maxAvg) * 100, 10);
                            const isPositive = day.avgReward >= 0;
                            return (
                              <div
                                key={day.date}
                                className="flex-1 flex flex-col justify-end"
                                title={`${day.date}: ${day.avgReward.toFixed(2)} avg (${day.count} events)`}
                              >
                                <div
                                  className={cn(
                                    "w-full rounded-t transition-all",
                                    isPositive ? "bg-green-500/60" : "bg-red-500/60"
                                  )}
                                  style={{ height: `${height}%` }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
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
        )}
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
