import { useState, useEffect } from 'react';
import { 
  Brain, 
  TrendingUp, 
  Users, 
  Share2, 
  Download, 
  Lock, 
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  Target,
  Layers,
  RefreshCw,
  ArrowLeft,
  Image
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  ScatterChart,
  Scatter,
  ReferenceLine,
} from 'recharts';
import { 
  getTotalPredictions, 
  getAccuracyStats,
  getPerformanceStats,
  getPredictionComparisons,
  exportPerformanceReport,
} from '@/lib/languagePredictor';
import { 
  getRewardStats, 
  getAllRewards,
  type RewardStats,
} from '@/lib/rewardTracking';
import {
  getFederatedStatus,
  getLocalLearningStatus,
  exportGradientsForAggregation,
  type LocalLearningStatus,
} from '@/lib/federatedLearning';

// Chart colors
const COLORS = {
  purple: 'hsl(280, 70%, 60%)',
  blue: 'hsl(210, 80%, 60%)',
  green: 'hsl(150, 70%, 50%)',
  red: 'hsl(0, 70%, 60%)',
  yellow: 'hsl(45, 90%, 55%)',
  cyan: 'hsl(180, 70%, 50%)',
  orange: 'hsl(30, 80%, 55%)',
  pink: 'hsl(330, 70%, 60%)',
};

const PROFILE_COLORS = {
  local: COLORS.green,
  expatriate: COLORS.blue,
  traveler: COLORS.orange,
  multilingual: COLORS.purple,
};

const REWARD_COLORS = {
  dwell_30s: COLORS.green,
  dwell_60s: COLORS.green,
  dwell_bonus: COLORS.cyan,
  scroll_engaged: COLORS.blue,
  language_switch: COLORS.red,
  explicit_positive: '#22c55e',
  explicit_negative: '#ef4444',
  return_visit: COLORS.purple,
  high_confidence_bonus: COLORS.yellow,
};

export default function ModelDashboard() {
  const [totalPredictions, setTotalPredictions] = useState(0);
  const [accuracyStats, setAccuracyStats] = useState<{ accuracy: number; total: number } | null>(null);
  const [rewardStats, setRewardStats] = useState<RewardStats | null>(null);
  const [learningStatus, setLearningStatus] = useState<LocalLearningStatus | null>(null);
  const [federatedEnabled, setFederatedEnabled] = useState(false);
  const [performanceStats, setPerformanceStats] = useState<any>(null);
  
  useEffect(() => {
    // Load all data
    setTotalPredictions(getTotalPredictions());
    setAccuracyStats(getAccuracyStats());
    setRewardStats(getRewardStats());
    setLearningStatus(getLocalLearningStatus());
    setFederatedEnabled(getFederatedStatus().consent === true);
    setPerformanceStats(getPerformanceStats());
  }, []);
  
  // Prepare accuracy trend data
  const accuracyTrendData = learningStatus?.improvementHistory.map((imp, idx) => ({
    day: idx + 1,
    trained: imp.accuracyAfter,
    heuristic: 70 + Math.random() * 10, // Simulated heuristic baseline
    updated: imp.improved,
  })) || [];
  
  // Prepare profile distribution data
  const profileDistribution = rewardStats ? 
    Object.entries(rewardStats.rewardByProfile).map(([profile, data]) => ({
      name: profile.charAt(0).toUpperCase() + profile.slice(1),
      value: data.count,
      avgReward: data.average,
    })) : [];
  
  // Prepare reward breakdown data
  const rewardBreakdown = rewardStats ?
    Object.entries(rewardStats.rewardByReason).map(([reason, data]) => ({
      name: formatReasonLabel(reason),
      count: data.count,
      total: data.total,
      fill: REWARD_COLORS[reason as keyof typeof REWARD_COLORS] || COLORS.purple,
    })) : [];
  
  // Calculate total reward score
  const totalRewardScore = rewardStats ? 
    Object.values(rewardStats.rewardByReason).reduce((sum, d) => sum + d.total, 0) : 0;
  
  // Confidence calibration data (simulated from rewards)
  const confidenceCalibration = getAllRewards().slice(-20).map(r => ({
    confidence: r.confidence,
    reward: r.reward,
    profile: r.userProfile,
  }));
  
  // Feature importance (simulated)
  const featureImportance = [
    { name: 'Language Count', importance: 35 },
    { name: 'Timezone Match', importance: 25 },
    { name: 'Primary Language', importance: 20 },
    { name: 'Browser Locale', importance: 12 },
    { name: 'Visit History', importance: 8 },
  ];
  
  // Export full report
  const handleExportReport = () => {
    const report = {
      exportedAt: new Date().toISOString(),
      overview: {
        totalPredictions,
        accuracy: accuracyStats?.accuracy || 0,
        localUpdates: learningStatus?.totalUpdates || 0,
        federatedEnabled,
      },
      accuracyTrend: accuracyTrendData,
      profileDistribution,
      rewardBreakdown,
      totalRewardScore,
      confidenceCalibration,
      featureImportance,
      learningHistory: learningStatus?.improvementHistory || [],
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model-performance-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/20 to-slate-950 text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-lg border-b border-purple-500/20">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link 
              to="/"
              className="flex items-center gap-2 text-purple-400/70 hover:text-purple-400 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </Link>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Brain className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-purple-200">Model Performance Dashboard</h1>
                <p className="text-xs text-purple-400/60">Complete AI Learning System Analytics</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportReport}
              className="flex items-center gap-2 px-3 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg text-purple-400 text-sm hover:bg-purple-500/30 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export Report
            </button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <OverviewCard
            icon={<Activity className="w-5 h-5" />}
            label="Total Predictions"
            value={totalPredictions.toLocaleString()}
            color="purple"
          />
          <OverviewCard
            icon={<Target className="w-5 h-5" />}
            label="Model Accuracy"
            value={`${(accuracyStats?.accuracy || 0).toFixed(1)}%`}
            color="green"
            trend={learningStatus && learningStatus.currentAccuracy > 70 ? 'up' : undefined}
          />
          <OverviewCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Local Updates"
            value={learningStatus?.successfulUpdates.toString() || '0'}
            subValue={`of ${learningStatus?.totalUpdates || 0}`}
            color="blue"
          />
          <OverviewCard
            icon={<Share2 className="w-5 h-5" />}
            label="Federated Status"
            value={federatedEnabled ? 'Enabled' : 'Disabled'}
            color={federatedEnabled ? 'cyan' : 'gray'}
          />
        </div>
        
        {/* Charts Row 1 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Accuracy Over Time */}
          <ChartCard title="Accuracy Over Time" icon={<TrendingUp className="w-4 h-4" />}>
            {accuracyTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={accuracyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                  <XAxis 
                    dataKey="day" 
                    stroke="rgba(139, 92, 246, 0.5)" 
                    fontSize={10}
                    tickFormatter={(v) => `Day ${v}`}
                  />
                  <YAxis 
                    stroke="rgba(139, 92, 246, 0.5)" 
                    fontSize={10}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15, 10, 30, 0.95)', 
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'rgba(139, 92, 246, 0.8)' }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="trained" 
                    stroke={COLORS.purple} 
                    strokeWidth={2}
                    dot={{ fill: COLORS.purple, r: 3 }}
                    name="Trained Model"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="heuristic" 
                    stroke={COLORS.cyan}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Heuristics"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No accuracy data yet. Enable federated learning and use the app." />
            )}
          </ChartCard>
          
          {/* Prediction Distribution */}
          <ChartCard title="Prediction Distribution" icon={<PieChartIcon className="w-4 h-4" />}>
            {profileDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={profileDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: 'rgba(139, 92, 246, 0.3)' }}
                  >
                    {profileDistribution.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={PROFILE_COLORS[entry.name.toLowerCase() as keyof typeof PROFILE_COLORS] || COLORS.purple}
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15, 10, 30, 0.95)', 
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string, props: any) => [
                      `${value} predictions (Avg reward: ${props.payload.avgReward?.toFixed(2) || 0})`,
                      name
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No prediction data yet." />
            )}
          </ChartCard>
        </div>
        
        {/* Reward Signals Breakdown */}
        <ChartCard title="Reward Signals Breakdown" icon={<BarChart3 className="w-4 h-4" />} fullWidth>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-purple-400/70">
              Total Reward Score: <span className={cn(
                "font-bold ml-1",
                totalRewardScore >= 0 ? "text-green-400" : "text-red-400"
              )}>
                {totalRewardScore >= 0 ? '+' : ''}{totalRewardScore.toFixed(1)}
              </span>
            </div>
          </div>
          {rewardBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={rewardBreakdown} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                <XAxis type="number" stroke="rgba(139, 92, 246, 0.5)" fontSize={10} />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  stroke="rgba(139, 92, 246, 0.5)" 
                  fontSize={10}
                  width={100}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(15, 10, 30, 0.95)', 
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number, name: string) => [
                    `${value} events`,
                    'Count'
                  ]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {rewardBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No reward signals recorded yet." />
          )}
        </ChartCard>
        
        {/* Charts Row 2 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Model Learning Progress */}
          <ChartCard title="Model Learning Progress" icon={<Layers className="w-4 h-4" />}>
            {learningStatus && learningStatus.improvementHistory.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {learningStatus.improvementHistory.slice(-8).reverse().map((imp, idx) => (
                  <div 
                    key={idx}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-lg text-xs",
                      imp.improved 
                        ? "bg-green-500/10 border border-green-500/20" 
                        : "bg-red-500/10 border border-red-500/20"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {imp.improved ? (
                        <TrendingUp className="w-3 h-3 text-green-400" />
                      ) : (
                        <RefreshCw className="w-3 h-3 text-red-400" />
                      )}
                      <span className="text-purple-300/70">
                        {new Date(imp.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-purple-400/50">{imp.accuracyBefore.toFixed(1)}%</span>
                      <span className="text-purple-300">→</span>
                      <span className={imp.improved ? "text-green-400" : "text-red-400"}>
                        {imp.accuracyAfter.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No learning updates yet. Enable federated learning first." />
            )}
          </ChartCard>
          
          {/* Confidence Calibration */}
          <ChartCard title="Confidence Calibration" icon={<Target className="w-4 h-4" />}>
            {confidenceCalibration.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                  <XAxis 
                    type="number" 
                    dataKey="confidence" 
                    name="Confidence" 
                    domain={[0, 100]}
                    stroke="rgba(139, 92, 246, 0.5)" 
                    fontSize={10}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="reward" 
                    name="Reward" 
                    stroke="rgba(139, 92, 246, 0.5)" 
                    fontSize={10}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15, 10, 30, 0.95)', 
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) => [value, name]}
                  />
                  <ReferenceLine y={0} stroke="rgba(139, 92, 246, 0.3)" />
                  <Scatter 
                    data={confidenceCalibration} 
                    fill={COLORS.purple}
                  >
                    {confidenceCalibration.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.reward > 0 ? COLORS.green : COLORS.red}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="Need more reward data for calibration analysis." />
            )}
            <p className="text-[10px] text-purple-400/50 mt-2 text-center">
              Ideal: High confidence predictions should yield high rewards
            </p>
          </ChartCard>
        </div>
        
        {/* Feature Importance */}
        <ChartCard title="Feature Importance" icon={<Layers className="w-4 h-4" />} fullWidth>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {featureImportance.map((feature, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-purple-300/70">{feature.name}</span>
                  <span className="text-purple-400 font-mono">{feature.importance}%</span>
                </div>
                <div className="h-2 bg-purple-500/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all"
                    style={{ width: `${feature.importance}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
        
        {/* Export Options */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={handleExportReport}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg text-purple-400 text-sm hover:bg-purple-500/30 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Full Report (JSON)
          </button>
          <button
            onClick={() => {
              // Would use html2canvas in production
              alert('Chart export would use html2canvas library');
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-400 text-sm hover:bg-blue-500/30 transition-colors"
          >
            <Image className="w-4 h-4" />
            Export Chart as Image
          </button>
          {federatedEnabled && (
            <button
              onClick={() => {
                const gradients = exportGradientsForAggregation();
                if (gradients) {
                  const blob = new Blob([JSON.stringify(gradients, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `anonymous-stats-${Date.now()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-cyan-400 text-sm hover:bg-cyan-500/30 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              Share Anonymous Stats
            </button>
          )}
        </div>
        
        {/* Privacy Banner */}
        <div className="bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border border-purple-500/20 rounded-xl p-4 flex items-center justify-center gap-3">
          <Lock className="w-5 h-5 text-purple-400" />
          <p className="text-sm text-purple-300/80">
            All data shown is <strong className="text-purple-300">local to your device only</strong>. Your privacy is protected.
          </p>
          <span className="text-lg">🔒</span>
        </div>
      </main>
    </div>
  );
}

// Helper Components

function OverviewCard({ 
  icon, 
  label, 
  value, 
  subValue,
  color,
  trend 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string;
  subValue?: string;
  color: string;
  trend?: 'up' | 'down';
}) {
  const colorClasses: Record<string, string> = {
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-400',
    green: 'from-green-500/20 to-green-600/10 border-green-500/30 text-green-400',
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400',
    cyan: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30 text-cyan-400',
    gray: 'from-gray-500/20 to-gray-600/10 border-gray-500/30 text-gray-400',
  };
  
  return (
    <div className={cn(
      "bg-gradient-to-br border rounded-xl p-4",
      colorClasses[color] || colorClasses.purple
    )}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs opacity-70">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold">{value}</span>
        {subValue && <span className="text-xs opacity-50">{subValue}</span>}
        {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-400 ml-1" />}
      </div>
    </div>
  );
}

function ChartCard({ 
  title, 
  icon, 
  children, 
  fullWidth 
}: { 
  title: string; 
  icon: React.ReactNode; 
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn(
      "bg-gradient-to-br from-purple-500/5 to-indigo-500/5 border border-purple-500/20 rounded-xl p-4",
      fullWidth && "col-span-full"
    )}>
      <div className="flex items-center gap-2 mb-4 text-purple-400">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-48 flex items-center justify-center">
      <p className="text-sm text-purple-400/40 text-center">{message}</p>
    </div>
  );
}

function formatReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    'dwell_30s': 'Dwell 30s',
    'dwell_60s': 'Dwell 60s',
    'dwell_bonus': 'Dwell Bonus',
    'scroll_engaged': 'Scroll Engaged',
    'language_switch': 'Language Switch',
    'explicit_positive': 'Thumbs Up',
    'explicit_negative': 'Thumbs Down',
    'return_visit': 'Return Visit',
    'high_confidence_bonus': 'Confidence Bonus',
  };
  return labels[reason] || reason;
}