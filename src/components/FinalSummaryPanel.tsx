import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Download, Share2, Shield, RotateCcw, ChevronRight, AlertTriangle, 
  CheckCircle, Eye, Trophy, Target, FileJson, BookOpen, Zap,
  Mouse, Keyboard, Users, ShieldAlert, Fingerprint, Database,
  Globe, Smartphone
} from 'lucide-react';
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
  key: string;
  confirmed: number;
  total: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  criticalIssues: number;
  warnings: number;
}

interface PrivacyConcern {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium';
  category: string;
  fix?: string;
}

export default function FinalSummaryPanel({
  hexagons,
  confirmedCount,
  fingerprint,
  languagePrediction,
  onStartOver,
}: FinalSummaryPanelProps) {
  const [isExporting, setIsExporting] = useState(false);

  // Calculate category stats for all 8 categories
  const categoryStats = useMemo((): CategoryStats[] => {
    const categories: Record<string, { confirmed: number; total: number; critical: number; warnings: number }> = {
      device: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      network: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      privacy: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      language: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      orientation: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      fingerprint: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      storage: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      social: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      security: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      behavior: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
    };

    hexagons.forEach((hex) => {
      const cat = hex.category || 'device';
      if (categories[cat]) {
        categories[cat].total++;
        if (hex.confirmed) categories[cat].confirmed++;
        
        // Track critical issues and warnings
        const value = hex.value?.toLowerCase() || '';
        const label = hex.label?.toLowerCase() || '';
        
        if (value.includes('leak') || value.includes('critical') || value.includes('insecure')) {
          categories[cat].critical++;
        } else if (value.includes('warning') || value.includes('outdated') || value.includes('weak')) {
          categories[cat].warnings++;
        }
      }
    });

    return [
      {
        name: 'Device & Network',
        key: 'device',
        confirmed: categories.device.confirmed + categories.network.confirmed,
        total: categories.device.total + categories.network.total,
        icon: <Globe className="w-4 h-4" />,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
        criticalIssues: categories.device.critical + categories.network.critical,
        warnings: categories.device.warnings + categories.network.warnings,
      },
      {
        name: 'Language Intelligence',
        key: 'language',
        confirmed: categories.language.confirmed,
        total: categories.language.total,
        icon: <Globe className="w-4 h-4" />,
        color: 'text-cyan-400',
        bgColor: 'bg-cyan-500/10',
        criticalIssues: categories.language.critical,
        warnings: categories.language.warnings,
      },
      {
        name: 'Device Orientation',
        key: 'orientation',
        confirmed: categories.orientation.confirmed,
        total: categories.orientation.total,
        icon: <Smartphone className="w-4 h-4" />,
        color: 'text-orange-400',
        bgColor: 'bg-orange-500/10',
        criticalIssues: categories.orientation.critical,
        warnings: categories.orientation.warnings,
      },
      {
        name: 'Browser Fingerprint',
        key: 'fingerprint',
        confirmed: categories.fingerprint.confirmed,
        total: categories.fingerprint.total,
        icon: <Fingerprint className="w-4 h-4" />,
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        criticalIssues: categories.fingerprint.critical,
        warnings: categories.fingerprint.warnings,
      },
      {
        name: 'Storage Analysis',
        key: 'storage',
        confirmed: categories.storage.confirmed,
        total: categories.storage.total,
        icon: <Database className="w-4 h-4" />,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
        criticalIssues: categories.storage.critical,
        warnings: categories.storage.warnings,
      },
      {
        name: 'Social Accounts',
        key: 'social',
        confirmed: categories.social.confirmed,
        total: categories.social.total,
        icon: <Users className="w-4 h-4" />,
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/10',
        criticalIssues: categories.social.critical,
        warnings: categories.social.warnings,
      },
      {
        name: 'Security Status',
        key: 'security',
        confirmed: categories.security.confirmed,
        total: categories.security.total,
        icon: <ShieldAlert className="w-4 h-4" />,
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        criticalIssues: categories.security.critical,
        warnings: categories.security.warnings,
      },
      {
        name: 'Behavior Tracking',
        key: 'behavior',
        confirmed: categories.behavior.confirmed,
        total: categories.behavior.total,
        icon: <Mouse className="w-4 h-4" />,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/10',
        criticalIssues: categories.behavior.critical,
        warnings: categories.behavior.warnings,
      },
    ].filter((cat) => cat.total > 0);
  }, [hexagons]);

  // Calculate top privacy concerns
  const topConcerns = useMemo((): PrivacyConcern[] => {
    const concerns: PrivacyConcern[] = [];
    
    hexagons.forEach((hex) => {
      if (!hex.confirmed) return;
      
      const value = hex.value?.toLowerCase() || '';
      const label = hex.label?.toLowerCase() || '';
      
      // DNS Leak
      if (label.includes('dns') && value.includes('leak')) {
        concerns.push({
          title: 'DNS Leak Detected',
          description: 'Your DNS requests expose your browsing history to your ISP',
          severity: 'critical',
          category: 'security',
          fix: 'Enable DNS leak protection in your VPN settings',
        });
      }
      
      // WebRTC Leak
      if (label.includes('webrtc') && value.includes('leak')) {
        concerns.push({
          title: 'WebRTC IP Leak',
          description: 'Your real IP is visible even with VPN enabled',
          severity: 'critical',
          category: 'security',
          fix: 'Disable WebRTC in browser settings or use a WebRTC blocker',
        });
      }
      
      // Canvas Fingerprint
      if (label.includes('canvas') && hex.category === 'fingerprint') {
        concerns.push({
          title: 'Canvas Fingerprint Tracked',
          description: 'Your browser can be uniquely identified across websites',
          severity: 'high',
          category: 'fingerprint',
          fix: 'Use Brave browser or enable fingerprint protection',
        });
      }
      
      // Logged-in Social
      if (hex.category === 'social' && !value.includes('not detected') && !value.includes('0 services')) {
        if (label.includes('google')) {
          concerns.push({
            title: 'Google Tracking Active',
            description: 'Google can track you across 80% of websites',
            severity: 'high',
            category: 'social',
            fix: 'Log out of Google when not in use',
          });
        }
        if (label.includes('meta') || label.includes('facebook')) {
          concerns.push({
            title: 'Meta Tracking Active',
            description: 'Facebook tracks you on sites with Like buttons',
            severity: 'high',
            category: 'social',
            fix: 'Use Facebook Container or log out',
          });
        }
      }
      
      // Behavior tracking
      if (hex.category === 'behavior' && label.includes('mouse')) {
        concerns.push({
          title: 'Mouse Tracking Active',
          description: 'Your movement patterns create a 97% unique signature',
          severity: 'medium',
          category: 'behavior',
        });
      }
    });
    
    // Sort by severity and take top 5
    const severityOrder = { critical: 0, high: 1, medium: 2 };
    return concerns
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, 5);
  }, [hexagons]);

  // Calculate strengths
  const strengths = useMemo(() => {
    const positives: string[] = [];
    
    hexagons.forEach((hex) => {
      if (!hex.confirmed) return;
      const value = hex.value?.toLowerCase() || '';
      const label = hex.label?.toLowerCase() || '';
      
      if (label.includes('protection') && !value.includes('none')) {
        positives.push('Fingerprint protection enabled');
      }
      if (label.includes('dns') && value.includes('protected')) {
        positives.push('DNS leak protection active');
      }
      if (label.includes('https') && value.includes('secure')) {
        positives.push('HTTPS encryption enabled');
      }
      if ((label.includes('google') || label.includes('facebook')) && value.includes('not detected')) {
        positives.push('Not logged into major tracking platforms');
      }
      if (label.includes('cookies') && value.includes('blocked')) {
        positives.push('Third-party cookies blocked');
      }
    });
    
    return [...new Set(positives)].slice(0, 5);
  }, [hexagons]);

  // Calculate overall privacy risk score (FINAL FORMULA)
  const overallRisk = useMemo(() => {
    const weights = {
      device: 0.05,      // 5%
      privacy: 0.05,     // 5%
      language: 0.05,    // 5%
      orientation: 0.05, // 5%
      fingerprint: 0.25, // 25%
      storage: 0.10,     // 10%
      social: 0.20,      // 20%
      security: 0.15,    // 15%
      behavior: 0.10,    // 10%
    };

    let totalRisk = 0;
    
    categoryStats.forEach((cat) => {
      const catWeight = weights[cat.key as keyof typeof weights] || 0.05;
      const baseRisk = cat.total > 0 ? (cat.confirmed / cat.total) * 60 : 0;
      const criticalBonus = cat.criticalIssues * 20;
      const warningBonus = cat.warnings * 10;
      const catRisk = Math.min(baseRisk + criticalBonus + warningBonus, 100);
      totalRisk += catRisk * catWeight;
    });

    // Add fingerprint uniqueness bonus
    if (fingerprint) {
      const fpRiskMap = { high: 20, medium: 10, low: 0 };
      totalRisk += fpRiskMap[fingerprint.totalRisk] || 0;
    }

    return Math.min(Math.round(totalRisk), 100);
  }, [categoryStats, fingerprint]);

  // Calculate uniqueness estimate
  const uniquenessEstimate = useMemo(() => {
    const totalDataPoints = confirmedCount;
    // Rough estimate: each confirmed data point increases uniqueness
    const uniqueness = Math.min(Math.pow(2, totalDataPoints / 4), 1000000);
    return Math.round(uniqueness);
  }, [confirmedCount]);

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

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-400 bg-red-500/20 border-red-500/30';
      case 'high': return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      case 'medium': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      default: return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalDataPoints: 46,
        confirmedDataPoints: confirmedCount,
        overallPrivacyRisk: overallRisk,
        riskLevel: getRiskLabel(overallRisk),
        uniqueness: `1 in ${uniquenessEstimate.toLocaleString()} browsers`,
        trackingExposure: `${Math.round((confirmedCount / 46) * 100)}%`,
      },
      categories: categoryStats.map((cat) => ({
        name: cat.name,
        detectedItems: cat.total,
        confirmedItems: cat.confirmed,
        criticalIssues: cat.criticalIssues,
        warnings: cat.warnings,
        accuracyRate: cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0,
      })),
      topConcerns: topConcerns.map(c => ({
        title: c.title,
        description: c.description,
        severity: c.severity,
        fix: c.fix,
      })),
      strengths,
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
      privacyNote: 'This report was generated locally in your browser. No data was sent to any server.',
    };

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
    const shareText = `🎯 My Complete Digital Shadow - Final Report

📊 46 data points analyzed
🎯 ${confirmedCount} were accurate (${Math.round((confirmedCount / 46) * 100)}%)
⚠️ Privacy Risk: ${overallRisk}/100 (${getRiskLabel(overallRisk)})
🔍 Uniqueness: 1 in ${uniquenessEstimate.toLocaleString()} browsers
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
      <CardHeader className="border-b border-green-500/20 pb-4 bg-gradient-to-r from-green-950/30 via-cyan-950/30 to-amber-950/30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/20">
            <Target className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold text-green-400 flex items-center gap-2">
              🎯 Your Complete Digital Shadow
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                <Trophy className="w-3 h-3 mr-1" />
                FINAL REPORT
              </Badge>
            </CardTitle>
            <p className="text-sm text-green-300/70 font-normal">
              Complete analysis of 46 data points across 8 categories
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Overall Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-black/30 rounded-lg border border-green-500/20 text-center">
            <p className="text-2xl font-bold text-green-400">46</p>
            <p className="text-xs text-green-300/60">Data Points</p>
          </div>
          <div className="p-3 bg-black/30 rounded-lg border border-green-500/20 text-center">
            <p className={`text-2xl font-bold ${getRiskColor(overallRisk)}`}>{overallRisk}</p>
            <p className="text-xs text-green-300/60">Risk Score</p>
          </div>
          <div className="p-3 bg-black/30 rounded-lg border border-green-500/20 text-center">
            <p className="text-lg font-bold text-purple-400">1:{uniquenessEstimate.toLocaleString()}</p>
            <p className="text-xs text-green-300/60">Uniqueness</p>
          </div>
          <div className="p-3 bg-black/30 rounded-lg border border-green-500/20 text-center">
            <p className="text-2xl font-bold text-cyan-400">{Math.round((confirmedCount / 46) * 100)}%</p>
            <p className="text-xs text-green-300/60">Exposure</p>
          </div>
        </div>

        {/* Overall Risk Score Circle */}
        <div className="text-center p-6 bg-black/30 rounded-xl border border-green-500/20">
          <p className="text-green-300/70 text-sm mb-2">Overall Privacy Risk</p>
          <div className="relative inline-block">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(0, 255, 65, 0.1)" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="40" fill="none"
                stroke={overallRisk >= 70 ? '#ef4444' : overallRisk >= 40 ? '#eab308' : '#22c55e'}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${overallRisk * 2.51} 251`}
                className="transition-all duration-1000 ease-out"
                style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-bold ${getRiskColor(overallRisk)}`} style={{ textShadow: '0 0 15px currentColor' }}>
                {overallRisk}
              </span>
              <span className="text-xs text-green-300/60">/100</span>
            </div>
          </div>
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold mt-4 ${getRiskBgColor(overallRisk)}/20 ${getRiskColor(overallRisk)} border border-current/30`}>
            {overallRisk >= 70 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
            {getRiskLabel(overallRisk)}
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-green-300 flex items-center gap-2">
            📊 Category Breakdown (8 Categories)
          </h4>
          <div className="grid gap-2">
            {categoryStats.map((cat) => {
              const percentage = cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0;
              return (
                <div key={cat.name} className={`flex items-center gap-3 p-3 ${cat.bgColor} rounded-lg border border-green-500/10`}>
                  <div className={`p-1.5 rounded ${cat.bgColor} ${cat.color}`}>{cat.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${cat.color}`}>{cat.name}</span>
                      <div className="flex items-center gap-2">
                        {cat.criticalIssues > 0 && (
                          <Badge variant="outline" className="text-red-400 border-red-500/30 text-xs px-1.5">
                            {cat.criticalIssues} critical
                          </Badge>
                        )}
                        <span className="text-xs text-green-300/60">{cat.confirmed}/{cat.total}</span>
                      </div>
                    </div>
                    <Progress value={percentage} className="h-1.5 bg-green-950/50" />
                  </div>
                  <span className={`text-sm font-mono ${percentage >= 80 ? 'text-red-400' : percentage >= 50 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top 5 Privacy Concerns */}
        {topConcerns.length > 0 && (
          <div className="p-4 bg-red-950/20 rounded-xl border border-red-500/20">
            <h4 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Top Privacy Concerns
            </h4>
            <div className="space-y-2">
              {topConcerns.map((concern, i) => (
                <div key={i} className={`p-3 rounded-lg border ${getSeverityColor(concern.severity)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{concern.title}</p>
                      <p className="text-xs opacity-70 mt-0.5">{concern.description}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs shrink-0 ${getSeverityColor(concern.severity)}`}>
                      {concern.severity}
                    </Badge>
                  </div>
                  {concern.fix && (
                    <div className="mt-2 flex items-center gap-1 text-xs opacity-80">
                      <Zap className="w-3 h-3" />
                      {concern.fix}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top 5 Strengths */}
        {strengths.length > 0 && (
          <div className="p-4 bg-green-950/20 rounded-xl border border-green-500/20">
            <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              What You're Doing Well
            </h4>
            <ul className="space-y-2">
              {strengths.map((strength, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-green-200/80">
                  <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  {strength}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Plan */}
        <div className="p-4 bg-gradient-to-r from-cyan-950/30 to-purple-950/30 rounded-xl border border-cyan-500/20">
          <h4 className="text-sm font-semibold text-cyan-400 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Prioritized Action Plan
          </h4>
          <ol className="space-y-2 text-sm text-cyan-200/80">
            {topConcerns.slice(0, 3).map((concern, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                {concern.fix || `Address ${concern.title.toLowerCase()}`}
              </li>
            ))}
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center flex-shrink-0">
                4
              </span>
              Use a privacy-focused browser like Brave or Firefox
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center flex-shrink-0">
                5
              </span>
              Regularly clear cookies and browser data
            </li>
          </ol>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={handleExportPDF} disabled={isExporting} className="border-green-500/30 text-green-300 hover:bg-green-950/30">
            <FileJson className="w-4 h-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Export JSON'}
          </Button>
          <Button variant="outline" onClick={handleShare} className="border-cyan-500/30 text-cyan-300 hover:bg-cyan-950/30">
            <Share2 className="w-4 h-4 mr-2" />
            Share Results
          </Button>
        </div>

        <div className="flex gap-3">
          <Button variant="default" onClick={onStartOver} className="flex-1 bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500">
            <RotateCcw className="w-4 h-4 mr-2" />
            Start New Scan
          </Button>
          <Button variant="outline" onClick={() => window.open('https://privacyguides.org', '_blank')} className="border-purple-500/30 text-purple-300 hover:bg-purple-950/30">
            <BookOpen className="w-4 h-4 mr-2" />
            Protection Guide
          </Button>
        </div>

        {/* Privacy Notice */}
        <div className="flex items-center gap-3 p-3 bg-green-950/30 rounded-lg border border-green-500/20">
          <span className="text-xl">🔒</span>
          <p className="text-xs text-green-300/80">
            <strong>100% Local:</strong> All 46 data points were analyzed in your browser. Nothing was transmitted to any server.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
