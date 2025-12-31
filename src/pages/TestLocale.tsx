import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Play, RotateCcw, Check, X, AlertTriangle, Zap, Database, Shield, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  analyzeLanguages, 
  predictLanguagePreference, 
  initializeModel,
  getLanguageName,
  type LanguageAnalysis,
  type LanguagePrediction,
} from '@/lib/languagePredictor';
import {
  testScenarios,
  createMockAnalysis,
  runValidationChecks,
  storeTestResults,
  calculateAccuracyStats,
  type TestScenario,
  type TestResult,
  type ValidationResults,
} from '@/lib/testScenarios';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function TestLocale() {
  const [liveAnalysis, setLiveAnalysis] = useState<LanguageAnalysis | null>(null);
  const [livePrediction, setLivePrediction] = useState<LanguagePrediction | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [validationResults, setValidationResults] = useState<ValidationResults | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  
  // Manual input state
  const [manualLanguages, setManualLanguages] = useState('en-US, es-MX');
  const [manualTimezone, setManualTimezone] = useState('America/New_York');
  const [manualPrediction, setManualPrediction] = useState<LanguagePrediction | null>(null);
  
  // Initialize and run live detection
  useEffect(() => {
    async function init() {
      setIsModelLoading(true);
      await initializeModel();
      
      const analysis = analyzeLanguages();
      setLiveAnalysis(analysis);
      
      const prediction = await predictLanguagePreference(analysis);
      setLivePrediction(prediction);
      
      const validation = await runValidationChecks();
      setValidationResults(validation);
      
      setIsModelLoading(false);
    }
    init();
  }, []);
  
  // Run all test scenarios
  const runAllTests = useCallback(async () => {
    setIsRunningTests(true);
    const results: TestResult[] = [];
    
    for (const scenario of testScenarios) {
      const startTime = performance.now();
      const mockAnalysis = createMockAnalysis(scenario);
      
      try {
        const prediction = await predictLanguagePreference(mockAnalysis);
        const endTime = performance.now();
        
        const topProfile = prediction.allProfiles[0]?.profile;
        const passed = topProfile === scenario.expectedProfile;
        const confidence = prediction.allProfiles[0]?.probability || 0;
        
        results.push({
          scenario,
          prediction,
          passed,
          confidence,
          executionTime: Math.round(endTime - startTime),
        });
      } catch (error) {
        results.push({
          scenario,
          prediction: null,
          passed: false,
          confidence: 0,
          executionTime: 0,
        });
      }
    }
    
    setTestResults(results);
    storeTestResults(results);
    setIsRunningTests(false);
  }, []);
  
  // Run manual prediction
  const runManualPrediction = useCallback(async () => {
    const languages = manualLanguages.split(',').map(l => l.trim()).filter(Boolean);
    if (languages.length === 0) return;
    
    const mockScenario: TestScenario = {
      id: 'manual',
      name: 'Manual Test',
      description: 'User-defined test case',
      expectedProfile: 'local',
      languages,
      timezone: manualTimezone,
      icon: '🧪',
    };
    
    const mockAnalysis = createMockAnalysis(mockScenario);
    const prediction = await predictLanguagePreference(mockAnalysis);
    setManualPrediction(prediction);
  }, [manualLanguages, manualTimezone]);
  
  const accuracyStats = calculateAccuracyStats(testResults);
  
  return (
    <div className="min-h-screen bg-black text-green-400 font-mono">
      {/* Header */}
      <header className="border-b border-green-500/30 p-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Link 
            to="/" 
            className="flex items-center gap-2 text-green-400/70 hover:text-green-400 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to App
          </Link>
          <h1 className="text-xl font-bold text-green-400">
            🧪 Language Intelligence Test Page
          </h1>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Validation Checks */}
        <section className="bg-black/50 border border-green-500/30 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-400 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            System Validation
          </h2>
          
          {validationResults ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <ValidationItem
                label="TensorFlow.js"
                passed={validationResults.tensorflowLoaded}
                icon={<Zap className="w-4 h-4" />}
              />
              <ValidationItem
                label="LocalStorage"
                passed={validationResults.localStorageWorks}
                icon={<Database className="w-4 h-4" />}
              />
              <ValidationItem
                label="Feedback System"
                passed={validationResults.feedbackWorks}
                icon={<Activity className="w-4 h-4" />}
              />
              <ValidationItem
                label="Analytics"
                passed={validationResults.analyticsWorks}
                icon={<Activity className="w-4 h-4" />}
              />
              <ValidationItem
                label="Browser Compatible"
                passed={validationResults.browserCompatible}
                icon={<Shield className="w-4 h-4" />}
              />
            </div>
          ) : (
            <div className="animate-pulse text-green-400/50">Running validation checks...</div>
          )}
          
          {validationResults?.errors.length ? (
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-yellow-400 text-sm font-medium mb-2">⚠️ Warnings:</p>
              <ul className="text-yellow-400/70 text-xs space-y-1">
                {validationResults.errors.map((error, i) => (
                  <li key={i}>• {error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        
        {/* Live Detection */}
        <section className="bg-black/50 border border-green-500/30 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-400 mb-4">
            📡 Live Detection (Your Browser)
          </h2>
          
          {isModelLoading ? (
            <div className="animate-pulse text-green-400/50">Loading TensorFlow.js model...</div>
          ) : liveAnalysis && livePrediction ? (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Raw Signals */}
              <div>
                <h3 className="text-sm font-medium text-green-400/70 mb-3">Detected Signals</h3>
                <Table>
                  <TableHeader>
                    <TableRow className="border-green-500/30">
                      <TableHead className="text-green-400/70">Signal</TableHead>
                      <TableHead className="text-green-400/70">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="border-green-500/20">
                      <TableCell className="text-green-400/80">Primary Language</TableCell>
                      <TableCell className="text-green-400">{liveAnalysis.primaryLanguage}</TableCell>
                    </TableRow>
                    <TableRow className="border-green-500/20">
                      <TableCell className="text-green-400/80">All Languages</TableCell>
                      <TableCell className="text-green-400">{liveAnalysis.languages.join(', ')}</TableCell>
                    </TableRow>
                    <TableRow className="border-green-500/20">
                      <TableCell className="text-green-400/80">Timezone</TableCell>
                      <TableCell className="text-green-400">{liveAnalysis.timezone}</TableCell>
                    </TableRow>
                    <TableRow className="border-green-500/20">
                      <TableCell className="text-green-400/80">Language Family</TableCell>
                      <TableCell className="text-green-400">{liveAnalysis.languageFamily}</TableCell>
                    </TableRow>
                    <TableRow className="border-green-500/20">
                      <TableCell className="text-green-400/80">Mismatch Detected</TableCell>
                      <TableCell className={liveAnalysis.hasLanguageLocationMismatch ? 'text-yellow-400' : 'text-green-400'}>
                        {liveAnalysis.hasLanguageLocationMismatch ? 'Yes' : 'No'}
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-green-500/20">
                      <TableCell className="text-green-400/80">VPN Probability</TableCell>
                      <TableCell className="text-green-400">{Math.round(liveAnalysis.vpnProbability * 100)}%</TableCell>
                    </TableRow>
                    <TableRow className="border-green-500/20">
                      <TableCell className="text-green-400/80">Expatriate Pattern</TableCell>
                      <TableCell className={liveAnalysis.expatriatePatternDetected ? 'text-cyan-400' : 'text-green-400'}>
                        {liveAnalysis.expatriatePatternDetected ? 'Detected' : 'Not detected'}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              
              {/* Prediction Output */}
              <div>
                <h3 className="text-sm font-medium text-green-400/70 mb-3">Model Prediction</h3>
                <div className="space-y-3">
                  <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <p className="text-xs text-green-400/70 mb-1">Preferred Language</p>
                    <p className="text-lg font-bold text-green-400">
                      {getLanguageName(livePrediction.preferredLanguage)}
                      <span className="text-sm font-normal text-green-400/70 ml-2">
                        ({livePrediction.preferredLanguageConfidence}% confidence)
                      </span>
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-xs text-green-400/70">Profile Probabilities:</p>
                    {livePrediction.allProfiles.map((profile, i) => (
                      <div key={profile.profile} className="flex items-center gap-3">
                        <span className="w-6 text-center">{profile.icon}</span>
                        <span className="flex-1 text-sm text-green-400/80 capitalize">{profile.profile}</span>
                        <div className="w-24 h-2 bg-green-500/20 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full transition-all",
                              i === 0 ? "bg-green-400" : "bg-green-400/50"
                            )}
                            style={{ width: `${profile.probability}%` }}
                          />
                        </div>
                        <span className="text-xs text-green-400/70 w-10 text-right">
                          {profile.probability}%
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-4 p-3 bg-black/50 border border-green-500/20 rounded-lg">
                    <p className="text-xs text-green-400/70 mb-2">Reasoning:</p>
                    <ul className="text-xs text-green-400/80 space-y-1">
                      {livePrediction.reasoning.slice(0, 3).map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
        
        {/* Manual Testing */}
        <section className="bg-black/50 border border-cyan-500/30 rounded-xl p-6">
          <h2 className="text-lg font-bold text-cyan-400 mb-4">
            🎛️ Manual Input Testing
          </h2>
          
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-xs text-cyan-400/70 mb-1 block">Languages (comma-separated)</label>
              <input
                type="text"
                value={manualLanguages}
                onChange={(e) => setManualLanguages(e.target.value)}
                className="w-full px-3 py-2 bg-black/50 border border-cyan-500/30 rounded-lg text-cyan-400 text-sm focus:border-cyan-400 focus:outline-none"
                placeholder="en-US, es-MX, fr-FR"
              />
            </div>
            <div>
              <label className="text-xs text-cyan-400/70 mb-1 block">Timezone</label>
              <input
                type="text"
                value={manualTimezone}
                onChange={(e) => setManualTimezone(e.target.value)}
                className="w-full px-3 py-2 bg-black/50 border border-cyan-500/30 rounded-lg text-cyan-400 text-sm focus:border-cyan-400 focus:outline-none"
                placeholder="America/New_York"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={runManualPrediction}
                className="w-full px-4 py-2 bg-cyan-500/20 border border-cyan-500/50 rounded-lg text-cyan-400 font-medium hover:bg-cyan-500/30 transition-colors flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" />
                Run Prediction
              </button>
            </div>
          </div>
          
          {manualPrediction && (
            <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
              <div className="flex items-center gap-4 mb-3">
                <span className="text-2xl">{manualPrediction.allProfiles[0]?.icon}</span>
                <div>
                  <p className="text-cyan-400 font-bold capitalize">
                    {manualPrediction.allProfiles[0]?.profile}
                  </p>
                  <p className="text-cyan-400/70 text-sm">
                    {manualPrediction.allProfiles[0]?.probability}% confidence
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {manualPrediction.allProfiles.map(p => (
                  <div key={p.profile} className="text-center">
                    <div className="text-lg">{p.icon}</div>
                    <div className="text-xs text-cyan-400/70 capitalize">{p.profile}</div>
                    <div className="text-sm text-cyan-400">{p.probability}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        
        {/* Test Scenarios */}
        <section className="bg-black/50 border border-purple-500/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-purple-400 flex items-center gap-2">
              🧪 Test Scenarios ({testScenarios.length} cases)
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setTestResults([])}
                className="px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-400 text-sm hover:bg-purple-500/20 transition-colors flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
              <button
                onClick={runAllTests}
                disabled={isRunningTests}
                className="px-4 py-1.5 bg-purple-500/20 border border-purple-500/50 rounded-lg text-purple-400 font-medium hover:bg-purple-500/30 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isRunningTests ? (
                  <>
                    <div className="w-4 h-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run All Tests
                  </>
                )}
              </button>
            </div>
          </div>
          
          {testResults.length > 0 && (
            <div className="mb-4 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-purple-400">{accuracyStats.overall}%</p>
                  <p className="text-xs text-purple-400/70">Overall Accuracy</p>
                </div>
                {Object.entries(accuracyStats.byProfile).map(([profile, stats]) => (
                  <div key={profile}>
                    <p className="text-lg font-bold text-purple-400">
                      {stats.correct}/{stats.total}
                    </p>
                    <p className="text-xs text-purple-400/70 capitalize">{profile}</p>
                  </div>
                ))}
              </div>
              {accuracyStats.bestScenario && (
                <p className="text-xs text-green-400 mt-3">
                  ✓ Best: {accuracyStats.bestScenario}
                </p>
              )}
              {accuracyStats.worstScenario && (
                <p className="text-xs text-red-400">
                  ✗ Needs work: {accuracyStats.worstScenario}
                </p>
              )}
            </div>
          )}
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-purple-500/30">
                  <TableHead className="text-purple-400/70">Scenario</TableHead>
                  <TableHead className="text-purple-400/70">Languages</TableHead>
                  <TableHead className="text-purple-400/70">Timezone</TableHead>
                  <TableHead className="text-purple-400/70">Expected</TableHead>
                  <TableHead className="text-purple-400/70">Predicted</TableHead>
                  <TableHead className="text-purple-400/70 text-center">Result</TableHead>
                  <TableHead className="text-purple-400/70 text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {testScenarios.map(scenario => {
                  const result = testResults.find(r => r.scenario.id === scenario.id);
                  return (
                    <TableRow key={scenario.id} className="border-purple-500/20">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{scenario.icon}</span>
                          <span className="text-purple-400">{scenario.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-purple-400/70 text-xs">
                        {scenario.languages.join(', ')}
                      </TableCell>
                      <TableCell className="text-purple-400/70 text-xs">
                        {scenario.timezone}
                      </TableCell>
                      <TableCell className="text-purple-400 capitalize">
                        {scenario.expectedProfile}
                      </TableCell>
                      <TableCell className={cn(
                        "capitalize",
                        result?.passed ? "text-green-400" : result ? "text-red-400" : "text-purple-400/50"
                      )}>
                        {result?.prediction?.allProfiles[0]?.profile || '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        {result ? (
                          result.passed ? (
                            <Check className="w-5 h-5 text-green-400 mx-auto" />
                          ) : (
                            <X className="w-5 h-5 text-red-400 mx-auto" />
                          )
                        ) : (
                          <span className="text-purple-400/30">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-purple-400/70 text-xs">
                        {result ? `${result.executionTime}ms` : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
        
        {/* Feedback Stats */}
        <section className="bg-black/50 border border-orange-500/30 rounded-xl p-6">
          <h2 className="text-lg font-bold text-orange-400 mb-4">
            📊 Feedback Statistics
          </h2>
          <FeedbackStatsDisplay />
        </section>
      </main>
      
      {/* Footer */}
      <footer className="border-t border-green-500/30 p-4 mt-8">
        <p className="text-center text-green-400/50 text-sm">
          LocaleIntent AI Test Suite • All tests run client-side • Press Shift+Alt+V for debug panel
        </p>
      </footer>
    </div>
  );
}

// Validation item component
function ValidationItem({ label, passed, icon }: { label: string; passed: boolean; icon: React.ReactNode }) {
  return (
    <div className={cn(
      "p-3 rounded-lg border flex items-center gap-3",
      passed 
        ? "bg-green-500/10 border-green-500/30" 
        : "bg-red-500/10 border-red-500/30"
    )}>
      <div className={passed ? "text-green-400" : "text-red-400"}>
        {icon}
      </div>
      <div>
        <p className={cn("text-sm font-medium", passed ? "text-green-400" : "text-red-400")}>
          {label}
        </p>
        <p className={cn("text-xs", passed ? "text-green-400/70" : "text-red-400/70")}>
          {passed ? 'Working' : 'Failed'}
        </p>
      </div>
      {passed ? (
        <Check className="w-4 h-4 text-green-400 ml-auto" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-red-400 ml-auto" />
      )}
    </div>
  );
}

// Feedback stats display
function FeedbackStatsDisplay() {
  const [stats, setStats] = useState<Record<string, number>>({});
  
  useEffect(() => {
    try {
      const stored = localStorage.getItem('locale_feedback_stats');
      if (stored) {
        setStats(JSON.parse(stored));
      }
    } catch {
      // Ignore
    }
  }, []);
  
  const correct = stats.correctPredictions || 0;
  const incorrect = stats.incorrectPredictions || 0;
  const total = correct + incorrect;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg text-center">
        <p className="text-2xl font-bold text-orange-400">{total}</p>
        <p className="text-xs text-orange-400/70">Total Feedback</p>
      </div>
      <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
        <p className="text-2xl font-bold text-green-400">{correct}</p>
        <p className="text-xs text-green-400/70">Correct Predictions</p>
      </div>
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
        <p className="text-2xl font-bold text-red-400">{incorrect}</p>
        <p className="text-xs text-red-400/70">Incorrect</p>
      </div>
      <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-center">
        <p className="text-2xl font-bold text-cyan-400">{accuracy}%</p>
        <p className="text-xs text-cyan-400/70">User-Reported Accuracy</p>
      </div>
    </div>
  );
}
