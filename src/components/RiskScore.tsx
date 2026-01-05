import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertCircle, Fingerprint } from 'lucide-react';
import { HexagonData } from '@/lib/deviceDetection';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';

interface RiskScoreProps {
  confirmed: number;
  total: number;
  hexagons?: HexagonData[];
  fingerprint?: CompositeFingerprint | null;
}

export default function RiskScore({ confirmed, total, hexagons, fingerprint }: RiskScoreProps) {
  // Calculate weighted risk score
  const riskData = useMemo(() => {
    // Category weights: fingerprint is heavily weighted
    const weights = {
      device: 0.20,     // 20%
      network: 0.20,    // 20%
      language: 0.15,   // 15%
      orientation: 0.15, // 15%
      fingerprint: 0.30, // 30%
    };

    let weightedScore = 0;
    let totalWeight = 0;

    if (hexagons && hexagons.length > 0) {
      // Calculate confirmation rates by category
      const categoryRates: Record<string, { confirmed: number; total: number }> = {};
      
      hexagons.forEach((hex) => {
        const cat = hex.category || 'device';
        if (!categoryRates[cat]) {
          categoryRates[cat] = { confirmed: 0, total: 0 };
        }
        categoryRates[cat].total++;
        if (hex.confirmed) categoryRates[cat].confirmed++;
      });

      // Device/network risk
      const deviceCats = ['device', 'network', 'privacy', 'profile'];
      const deviceTotal = deviceCats.reduce(
        (acc, c) => acc + (categoryRates[c]?.total || 0),
        0
      );
      const deviceConfirmed = deviceCats.reduce(
        (acc, c) => acc + (categoryRates[c]?.confirmed || 0),
        0
      );
      if (deviceTotal > 0) {
        weightedScore += (deviceConfirmed / deviceTotal) * 100 * (weights.device + weights.network);
        totalWeight += weights.device + weights.network;
      }

      // Language risk
      const langCat = categoryRates['language'];
      if (langCat && langCat.total > 0) {
        weightedScore += (langCat.confirmed / langCat.total) * 100 * weights.language;
        totalWeight += weights.language;
      }

      // Orientation risk
      const orientCat = categoryRates['orientation'];
      if (orientCat && orientCat.total > 0) {
        weightedScore += (orientCat.confirmed / orientCat.total) * 100 * weights.orientation;
        totalWeight += weights.orientation;
      }

      // Fingerprint risk (heavily weighted based on uniqueness)
      const fpCat = categoryRates['fingerprint'];
      if (fpCat && fpCat.total > 0) {
        let fpRisk = (fpCat.confirmed / fpCat.total) * 100;
        
        // Increase risk based on fingerprint uniqueness
        if (fingerprint) {
          const fpRiskMap = { high: 95, medium: 70, low: 40 };
          fpRisk = Math.max(fpRisk, fpRiskMap[fingerprint.totalRisk] || fpRisk);
          
          // Reduce by protection effectiveness
          if (fingerprint.protection) {
            const reductionMap = { high: 0.4, medium: 0.25, low: 0.1, none: 0 };
            fpRisk *= 1 - (reductionMap[fingerprint.protection.effectiveness] || 0);
          }
        }
        
        weightedScore += fpRisk * weights.fingerprint;
        totalWeight += weights.fingerprint;
      }
    }

    // Fallback to simple percentage if no detailed data
    const percentage = totalWeight > 0 
      ? Math.round(weightedScore / totalWeight)
      : total > 0 
        ? Math.round((confirmed / total) * 100)
        : 0;

    return {
      percentage: Math.min(percentage, 100),
      hasFingerprint: hexagons?.some((h) => h.category === 'fingerprint' && h.confirmed) || false,
      fingerprintRisk: fingerprint?.totalRisk || null,
    };
  }, [confirmed, total, hexagons, fingerprint]);

  const { percentage, hasFingerprint, fingerprintRisk } = riskData;
  
  const getRiskLevel = (pct: number) => {
    if (pct >= 80) return { label: 'High Risk', Icon: AlertCircle };
    if (pct >= 50) return { label: 'Medium Risk', Icon: AlertTriangle };
    if (pct >= 1) return { label: 'Low Risk', Icon: Shield };
    return { label: 'Scanning...', Icon: Shield };
  };

  const risk = getRiskLevel(percentage);

  return (
    <div className="bg-black/40 border border-green-500/30 rounded-xl p-4 sm:p-6 mx-2 sm:mx-auto mb-4 shadow-[0_0_20px_rgba(0,255,65,0.15)] backdrop-blur-sm max-w-[460px]">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
        {/* Score Circle */}
        <div className="relative flex-shrink-0">
          <svg className="w-20 h-20 sm:w-28 sm:h-28 -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgba(0, 255, 65, 0.2)"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={percentage >= 80 ? '#ff4444' : percentage >= 50 ? '#ffaa00' : '#00ff41'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.51} 251`}
              className="transition-all duration-500 ease-out"
              style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-xl sm:text-2xl font-bold", percentage >= 80 ? 'text-red-500' : percentage >= 50 ? 'text-yellow-500' : 'text-green-400')} style={{ textShadow: '0 0 10px currentColor' }}>
              {percentage}%
            </span>
          </div>
        </div>

        {/* Risk Info */}
        <div className="flex-1 text-center sm:text-left">
          <div className={cn(
            "inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-semibold mb-2 border",
            percentage >= 80 ? "bg-red-500/10 text-red-400 border-red-500/30" : 
            percentage >= 50 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : 
            "bg-green-500/10 text-green-400 border-green-500/30"
          )}>
            <risk.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            {risk.label}
          </div>

          <div className="text-green-300/70 text-sm sm:text-base">
            <span className="font-medium text-green-400">{confirmed}</span> of{' '}
            <span className="font-medium text-green-400">{total}</span> data points confirmed
          </div>

          {/* Fingerprint indicator */}
          {hasFingerprint && fingerprintRisk && (
            <div className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs mt-2 border",
              fingerprintRisk === 'high' ? "bg-red-500/10 text-red-400 border-red-500/20" :
              fingerprintRisk === 'medium' ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
              "bg-green-500/10 text-green-400 border-green-500/20"
            )}>
              <Fingerprint className="w-3 h-3" />
              Fingerprint: {fingerprintRisk.charAt(0).toUpperCase() + fingerprintRisk.slice(1)} risk
            </div>
          )}

          {/* Progress bar */}
          <div className="mt-2 sm:mt-3 h-1.5 sm:h-2 bg-green-900/30 rounded-full overflow-hidden max-w-xs mx-auto sm:mx-0 border border-green-500/20">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                percentage >= 80 ? "bg-red-500" : percentage >= 50 ? "bg-yellow-500" : "bg-green-500"
              )}
              style={{ width: `${percentage}%`, boxShadow: '0 0 10px currentColor' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
