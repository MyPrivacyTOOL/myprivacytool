import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Download, Share2, Shield, RotateCcw, ChevronRight, AlertTriangle, CheckCircle, Eye } from 'lucide-react';
import { HexagonData } from '@/lib/deviceDetection';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';
import { LanguagePrediction } from '@/lib/languagePredictor';

interface FinalSummaryPanelProps {
  hexagons: HexagonData[];
  confirmedCount: number;
  fingerprint?: CompositeFingerprint | null;
  languagePrediction?: LanguagePrediction | null;
  onStartOver?: () => void;
}

interface CategoryStats {
  name: string;
  confirmed: number;
  total: number;
  icon: string;
  color: string;
}

export default function FinalSummaryPanel({
  hexagons,
  confirmedCount,
  fingerprint,
  languagePrediction,
  onStartOver,
}: FinalSummaryPanelProps) {
  const [isExporting, setIsExporting] = useState(false);

  // Calculate category stats
  const categoryStats = useMemo((): CategoryStats[] => {
    const categories: Record<string, { confirmed: number; total: number }> = {
      device: { confirmed: 0, total: 0 },
      network: { confirmed: 0, total: 0 },
      privacy: { confirmed: 0, total: 0 },
      language: { confirmed: 0, total: 0 },
      orientation: { confirmed: 0, total: 0 },
      fingerprint: { confirmed: 0, total: 0 },
    };

    hexagons.forEach((hex) => {
      const cat = hex.category || 'device';
      if (categories[cat]) {
        categories[cat].total++;
        if (hex.confirmed) categories[cat].confirmed++;
      }
    });

    return [
      {
        name: 'Device Detection',
        confirmed: categories.device.confirmed,
        total: categories.device.total,
        icon: '💻',
        color: 'text-blue-400',
      },
      {
        name: 'Network Analysis',
        confirmed: categories.network.confirmed,
        total: categories.network.total,
        icon: '📡',
        color: 'text-cyan-400',
      },
      {
        name: 'Privacy Settings',
        confirmed: categories.privacy.confirmed,
        total: categories.privacy.total,
        icon: '🔒',
        color: 'text-green-400',
      },
      {
        name: 'Language Intelligence',
        confirmed: categories.language.confirmed,
        total: categories.language.total,
        icon: '🗣️',
        color: 'text-purple-400',
      },
      {
        name: 'Orientation & Motion',
        confirmed: categories.orientation.confirmed,
        total: categories.orientation.total,
        icon: '📱',
        color: 'text-amber-400',
      },
      {
        name: 'Browser Fingerprint',
        confirmed: categories.fingerprint.confirmed,
        total: categories.fingerprint.total,
        icon: '🔴',
        color: 'text-red-400',
      },
    ].filter((cat) => cat.total > 0);
  }, [hexagons]);

  // Calculate overall privacy risk score
  const overallRisk = useMemo(() => {
    let riskScore = 0;
    const weights = {
      device: 0.2,
      network: 0.2,
      language: 0.15,
      orientation: 0.15,
      fingerprint: 0.3,
    };

    // Device/network/privacy risk (from confirmation rate)
    const deviceConfirmRate = categoryStats
      .filter((c) => ['Device Detection', 'Network Analysis', 'Privacy Settings'].includes(c.name))
      .reduce((acc, c) => acc + (c.total > 0 ? c.confirmed / c.total : 0), 0) / 3;
    riskScore += deviceConfirmRate * 40 * (weights.device + weights.network);

    // Language risk
    const languageConfirmRate = categoryStats.find((c) => c.name === 'Language Intelligence');
    if (languageConfirmRate && languageConfirmRate.total > 0) {
      riskScore += (languageConfirmRate.confirmed / languageConfirmRate.total) * 100 * weights.language;
    }

    // Orientation risk
    const orientationConfirmRate = categoryStats.find((c) => c.name === 'Orientation & Motion');
    if (orientationConfirmRate && orientationConfirmRate.total > 0) {
      riskScore += (orientationConfirmRate.confirmed / orientationConfirmRate.total) * 100 * weights.orientation;
    }

    // Fingerprint risk (heavily weighted)
    if (fingerprint) {
      const fpRiskMap = { high: 90, medium: 50, low: 20 };
      const fpRisk = fpRiskMap[fingerprint.totalRisk] || 70;
      
      // Reduce by protection score
      const protectionReduction = fingerprint.protection
        ? (fingerprint.protection.score / 100) * 30
        : 0;
      
      riskScore += (fpRisk - protectionReduction) * weights.fingerprint;
    }

    return Math.min(Math.round(riskScore), 100);
  }, [categoryStats, fingerprint]);

  const getRiskColor = (risk: number) => {
    if (risk >= 70) return 'text-red-400';
    if (risk >= 40) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getRiskBgColor = (risk: number) => {
    if (risk >= 70) return 'bg-red-500';
    if (risk >= 40) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getRiskLabel = (risk: number) => {
    if (risk >= 70) return 'High Risk';
    if (risk >= 40) return 'Medium Risk';
    return 'Low Risk';
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    
    // Create comprehensive report data
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalDataPoints: hexagons.length,
        confirmedDataPoints: confirmedCount,
        overallPrivacyRisk: overallRisk,
        riskLevel: getRiskLabel(overallRisk),
      },
      categories: categoryStats.map((cat) => ({
        name: cat.name,
        detectedItems: cat.total,
        confirmedItems: cat.confirmed,
        accuracyRate: cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0,
      })),
      languageIntelligence: languagePrediction
        ? {
            predictedLanguage: languagePrediction.preferredLanguage,
            confidence: languagePrediction.preferredLanguageConfidence,
            profile: languagePrediction.userProfile,
          }
        : null,
      fingerprint: fingerprint
        ? {
            uniqueness: fingerprint.uniqueness,
            riskLevel: fingerprint.totalRisk,
            compositeHash: fingerprint.compositeHash,
            protection: fingerprint.protection
              ? {
                  score: fingerprint.protection.score,
                  effectiveness: fingerprint.protection.effectiveness,
                }
              : null,
          }
        : null,
      hexagons: hexagons.map((hex) => ({
        id: hex.id,
        label: hex.label,
        value: hex.value,
        confidence: hex.confidence,
        confirmed: hex.confirmed,
        category: hex.category,
      })),
      privacyNote:
        'This report was generated locally in your browser. No data was sent to any server.',
    };

    // Download as JSON (PDF would require additional library)
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digital-shadow-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setIsExporting(false);
  };

  const handleShare = () => {
    const shareText = `I just discovered my Digital Shadow! 🔍

📊 ${hexagons.length} data points detected
🎯 ${confirmedCount} were accurate
⚠️ Privacy Risk: ${overallRisk}/100 (${getRiskLabel(overallRisk)})
${fingerprint ? `🔴 Fingerprint: ${fingerprint.uniqueness}` : ''}

Test yours at: ${window.location.origin}`;

    if (navigator.share) {
      navigator.share({
        title: 'My Digital Shadow Report',
        text: shareText,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(shareText);
      alert('Summary copied to clipboard!');
    }
  };

  return (
    <Card className="bg-gradient-to-br from-gray-900/90 to-gray-800/90 border-green-500/30 overflow-hidden">
      <CardHeader className="border-b border-green-500/20 pb-4 bg-gradient-to-r from-green-950/30 to-cyan-950/30">
        <CardTitle className="flex items-center gap-3 text-green-400">
          <Eye className="w-6 h-6" />
          <div>
            <h3 className="text-xl font-bold">Your Complete Digital Shadow</h3>
            <p className="text-sm text-green-300/70 font-normal">
              Full analysis of your online fingerprint
            </p>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Overall Risk Score */}
        <div className="text-center p-6 bg-black/30 rounded-xl border border-green-500/20">
          <p className="text-green-300/70 text-sm mb-2">Overall Privacy Risk</p>
          <div className="relative inline-block">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="rgba(0, 255, 65, 0.1)"
                strokeWidth="8"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={
                  overallRisk >= 70 ? '#ef4444' : overallRisk >= 40 ? '#eab308' : '#22c55e'
                }
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${overallRisk * 2.51} 251`}
                className="transition-all duration-1000 ease-out"
                style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={`text-4xl font-bold ${getRiskColor(overallRisk)}`}
                style={{ textShadow: '0 0 15px currentColor' }}
              >
                {overallRisk}
              </span>
              <span className="text-xs text-green-300/60">/100</span>
            </div>
          </div>
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold mt-4 ${getRiskBgColor(overallRisk)}/20 ${getRiskColor(overallRisk)} border border-current/30`}
          >
            {overallRisk >= 70 ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {getRiskLabel(overallRisk)}
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-green-300 flex items-center gap-2">
            📊 Detection Breakdown
          </h4>
          <div className="grid gap-2">
            {categoryStats.map((cat) => {
              const percentage = cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0;
              return (
                <div
                  key={cat.name}
                  className="flex items-center gap-3 p-3 bg-black/20 rounded-lg border border-green-500/10"
                >
                  <span className="text-xl">{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${cat.color}`}>{cat.name}</span>
                      <span className="text-xs text-green-300/60">
                        {cat.confirmed}/{cat.total}
                      </span>
                    </div>
                    <Progress value={percentage} className="h-1.5 bg-green-950/50" />
                  </div>
                  <span
                    className={`text-sm font-mono ${percentage >= 80 ? 'text-red-400' : percentage >= 50 ? 'text-yellow-400' : 'text-green-400'}`}
                  >
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Key Insights */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Language Confidence */}
          {languagePrediction && (
            <div className="p-4 bg-purple-950/30 rounded-lg border border-purple-500/20">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🗣️</span>
                <span className="text-sm font-medium text-purple-300">Language Intelligence</span>
              </div>
              <p className="text-2xl font-bold text-purple-400">
                {Math.round(languagePrediction.preferredLanguageConfidence * 100)}%
              </p>
              <p className="text-xs text-purple-300/60">confidence score</p>
            </div>
          )}

          {/* Fingerprint Uniqueness */}
          {fingerprint && (
            <div className="p-4 bg-red-950/30 rounded-lg border border-red-500/20">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔴</span>
                <span className="text-sm font-medium text-red-300">Fingerprint</span>
              </div>
              <p className="text-2xl font-bold text-red-400">{fingerprint.uniqueness}</p>
              <p className="text-xs text-red-300/60">
                {fingerprint.protection?.effectiveness === 'high'
                  ? 'Well protected'
                  : 'Highly trackable'}
              </p>
            </div>
          )}
        </div>

        {/* Recommendations Summary */}
        <div className="p-4 bg-gradient-to-r from-green-950/30 to-cyan-950/30 rounded-xl border border-green-500/20">
          <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Quick Privacy Wins
          </h4>
          <ul className="space-y-2 text-sm text-green-200/80">
            {overallRisk >= 50 && (
              <li className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                Use a privacy-focused browser like Brave or Firefox
              </li>
            )}
            {fingerprint && fingerprint.totalRisk !== 'low' && (
              <li className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                Enable fingerprint protection in your browser settings
              </li>
            )}
            <li className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              Consider using a VPN to mask your network identity
            </li>
            <li className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              Regularly clear cookies and browser data
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={isExporting}
            className="border-green-500/30 text-green-300 hover:bg-green-950/30"
          >
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Download Report'}
          </Button>
          <Button
            variant="outline"
            onClick={handleShare}
            className="border-cyan-500/30 text-cyan-300 hover:bg-cyan-950/30"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share Results
          </Button>
        </div>

        <div className="flex gap-3">
          <Button
            variant="default"
            onClick={onStartOver}
            className="flex-1 bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Start Over
          </Button>
          <Button
            variant="outline"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="border-green-500/30 text-green-300 hover:bg-green-950/30"
          >
            Back to Top
          </Button>
        </div>

        {/* Privacy Notice */}
        <div className="flex items-center gap-3 p-3 bg-green-950/30 rounded-lg border border-green-500/20">
          <span className="text-xl">🔒</span>
          <p className="text-xs text-green-300/80">
            <strong>Privacy Protected:</strong> All analysis runs locally in your browser. No data
            is stored or transmitted to any server.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
