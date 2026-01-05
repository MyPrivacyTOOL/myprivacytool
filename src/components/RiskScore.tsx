import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertCircle, Fingerprint, Users } from 'lucide-react';
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
    // Updated category weights: social is heavily weighted (25%)
    const weights = {
      device: 0.10,      // 10% (device + network combined)
      privacy: 0.10,     // 10%
      language: 0.05,    // 5%
      orientation: 0.05, // 5%
      fingerprint: 0.30, // 30%
      storage: 0.10,     // 10%
      social: 0.25,      // 25% (highest single category)
      other: 0.05,       // 5%
    };

    let weightedScore = 0;
    let totalWeight = 0;
    let socialRiskLevel: 'low' | 'medium' | 'high' | 'critical' | null = null;
    let loggedInServices = 0;
    let hasGoogle = false;
    let hasFacebook = false;
    let hasSSO = false;

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
        
        // Track social service logins for risk calculation
        if (cat === 'social' && hex.confirmed) {
          const value = hex.value?.toLowerCase() || '';
          const label = hex.label?.toLowerCase() || '';
          
          if (!value.includes('not detected') && !value.includes('no platform') && !value.includes('not linked')) {
            if (label.includes('google')) {
              hasGoogle = true;
              loggedInServices++;
            } else if (label.includes('meta') || label.includes('facebook')) {
              hasFacebook = true;
              loggedInServices++;
            } else if (label.includes('microsoft')) {
              loggedInServices++;
            } else if (label.includes('social platform')) {
              const match = value.match(/(\d+)/);
              loggedInServices += match ? parseInt(match[1]) : 1;
            } else if (label.includes('cross-site') || label.includes('identity')) {
              if (value.includes('linked') || value.includes('connection')) {
                hasSSO = true;
              }
            }
          }
        }
      });

      // Device/network risk (combined 10%)
      const deviceCats = ['device', 'network'];
      const deviceTotal = deviceCats.reduce((acc, c) => acc + (categoryRates[c]?.total || 0), 0);
      const deviceConfirmed = deviceCats.reduce((acc, c) => acc + (categoryRates[c]?.confirmed || 0), 0);
      if (deviceTotal > 0) {
        weightedScore += (deviceConfirmed / deviceTotal) * 100 * weights.device;
        totalWeight += weights.device;
      }

      // Privacy risk (10%)
      const privacyCats = ['privacy', 'profile'];
      const privacyTotal = privacyCats.reduce((acc, c) => acc + (categoryRates[c]?.total || 0), 0);
      const privacyConfirmed = privacyCats.reduce((acc, c) => acc + (categoryRates[c]?.confirmed || 0), 0);
      if (privacyTotal > 0) {
        weightedScore += (privacyConfirmed / privacyTotal) * 100 * weights.privacy;
        totalWeight += weights.privacy;
      }

      // Language risk (5%)
      const langCat = categoryRates['language'];
      if (langCat && langCat.total > 0) {
        weightedScore += (langCat.confirmed / langCat.total) * 100 * weights.language;
        totalWeight += weights.language;
      }

      // Orientation risk (5%)
      const orientCat = categoryRates['orientation'];
      if (orientCat && orientCat.total > 0) {
        weightedScore += (orientCat.confirmed / orientCat.total) * 100 * weights.orientation;
        totalWeight += weights.orientation;
      }

      // Fingerprint risk (30%)
      const fpCat = categoryRates['fingerprint'];
      if (fpCat && fpCat.total > 0) {
        let fpRisk = (fpCat.confirmed / fpCat.total) * 100;
        
        if (fingerprint) {
          const fpRiskMap = { high: 95, medium: 70, low: 40 };
          fpRisk = Math.max(fpRisk, fpRiskMap[fingerprint.totalRisk] || fpRisk);
          
          if (fingerprint.protection) {
            const reductionMap = { high: 0.4, medium: 0.25, low: 0.1, none: 0 };
            fpRisk *= 1 - (reductionMap[fingerprint.protection.effectiveness] || 0);
          }
        }
        
        weightedScore += fpRisk * weights.fingerprint;
        totalWeight += weights.fingerprint;
      }

      // Storage risk (10%)
      const storageCat = categoryRates['storage'];
      if (storageCat && storageCat.total > 0) {
        const storageRisk = (storageCat.confirmed / storageCat.total) * 100;
        weightedScore += storageRisk * weights.storage;
        totalWeight += weights.storage;
      }

      // Social risk (25%) - heavily weighted based on logged-in services
      const socialCat = categoryRates['social'];
      if (socialCat && socialCat.total > 0) {
        let socialRisk = 0;
        
        // Base risk from confirmation rate
        socialRisk = (socialCat.confirmed / socialCat.total) * 30;
        
        // Add risk based on logged-in services
        if (loggedInServices >= 3) {
          socialRisk += 60; // 3+ services: +60 points
        } else if (loggedInServices >= 1) {
          socialRisk += 30; // 1-2 services: +30 points
        }
        
        // Google or Facebook: +20 each
        if (hasGoogle) socialRisk += 20;
        if (hasFacebook) socialRisk += 20;
        
        // SSO detected: +40 (critical)
        if (hasSSO) socialRisk += 40;
        
        // Cap at 100
        socialRisk = Math.min(socialRisk, 100);
        
        // Determine social risk level
        if (hasSSO || (hasGoogle && hasFacebook) || loggedInServices >= 4) {
          socialRiskLevel = 'critical';
        } else if (loggedInServices >= 2 || hasGoogle || hasFacebook) {
          socialRiskLevel = 'high';
        } else if (loggedInServices >= 1) {
          socialRiskLevel = 'medium';
        } else {
          socialRiskLevel = 'low';
        }
        
        weightedScore += socialRisk * weights.social;
        totalWeight += weights.social;
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
      hasSocial: hexagons?.some((h) => h.category === 'social' && h.confirmed) || false,
      socialRiskLevel,
      loggedInServices,
    };
  }, [confirmed, total, hexagons, fingerprint]);

  const { percentage, hasFingerprint, fingerprintRisk, hasSocial, socialRiskLevel, loggedInServices } = riskData;
  
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

          {/* Risk indicators row */}
          <div className="flex flex-wrap gap-2 mt-2 justify-center sm:justify-start">
            {/* Fingerprint indicator */}
            {hasFingerprint && fingerprintRisk && (
              <div className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                fingerprintRisk === 'high' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                fingerprintRisk === 'medium' ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                "bg-green-500/10 text-green-400 border-green-500/20"
              )}>
                <Fingerprint className="w-3 h-3" />
                FP: {fingerprintRisk.charAt(0).toUpperCase() + fingerprintRisk.slice(1)}
              </div>
            )}

            {/* Social tracking indicator */}
            {hasSocial && socialRiskLevel && (
              <div className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                socialRiskLevel === 'critical' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                socialRiskLevel === 'high' ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                socialRiskLevel === 'medium' ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                "bg-green-500/10 text-green-400 border-green-500/20"
              )}>
                <Users className="w-3 h-3" />
                Social: {socialRiskLevel === 'critical' ? 'Critical' : loggedInServices > 0 ? `${loggedInServices} logged in` : 'Safe'}
              </div>
            )}
          </div>

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
