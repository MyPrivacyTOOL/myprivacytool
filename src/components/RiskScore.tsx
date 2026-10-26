import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertCircle, Fingerprint, Users, ShieldAlert, Activity } from 'lucide-react';
import { HexagonData } from '@/lib/deviceDetection';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';
import { exposureForPage, byBand, BAND_LABEL } from '@/lib/exposureScore';

interface RiskScoreProps {
  confirmed: number;
  total: number;
  hexagons?: HexagonData[];
  fingerprint?: CompositeFingerprint | null;
}

export default function RiskScore({ confirmed, total, hexagons, fingerprint }: RiskScoreProps) {
  // MPC-7471-F4: the score itself comes from the shared contract; this block only derives the display flags (social, security, behaviour levels).
  const riskData = useMemo(() => {
    let socialRiskLevel: 'low' | 'medium' | 'high' | 'critical' | null = null;
    let securityRiskLevel: 'low' | 'medium' | 'high' | 'critical' | null = null;
    let behaviorRiskLevel: 'low' | 'medium' | 'high' | null = null;
    let loggedInServices = 0;
    let hasGoogle = false;
    let hasFacebook = false;
    let hasSSO = false;
    let hasDNSLeak = false;
    let hasWebRTCLeak = false;
    let hasHTTPOnly = false;
    let hasOutdatedBrowser = false;
    let securityIssuesCount = 0;
    let behaviorDataPoints = 0;

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
        
        // Track security vulnerabilities for risk calculation
        if (cat === 'security' && hex.confirmed) {
          const value = hex.value?.toLowerCase() || '';
          const label = hex.label?.toLowerCase() || '';
          
          if (label.includes('dns') && (value.includes('leak') || value.includes('leaking'))) {
            hasDNSLeak = true;
            securityIssuesCount++;
          }
          if (label.includes('webrtc') && value.includes('leak')) {
            hasWebRTCLeak = true;
            securityIssuesCount++;
          }
          if ((label.includes('connection') || label.includes('https')) && value.includes('insecure')) {
            hasHTTPOnly = true;
            securityIssuesCount++;
          }
          if (label.includes('browser') && (value.includes('outdated') || value.includes('vulnerable'))) {
            hasOutdatedBrowser = true;
            securityIssuesCount++;
          }
          if (label.includes('mixed') && !value.includes('none')) {
            securityIssuesCount++;
          }
          if (label.includes('headers') && value.includes('weak')) {
            securityIssuesCount++;
          }
          if (label.includes('encryption') && value.includes('weak')) {
            securityIssuesCount++;
          }
        }
      });

      // Social risk (20%) - heavily weighted based on logged-in services
      const socialCat = categoryRates['social'];
      if (socialCat && socialCat.total > 0) {
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
      }

      // Security risk (20%) - CRITICAL weight for vulnerabilities
      const securityCat = categoryRates['security'];
      if (securityCat && securityCat.total > 0) {
        // Determine security risk level
        if (hasDNSLeak || hasWebRTCLeak) {
          securityRiskLevel = 'critical';
        } else if (hasHTTPOnly || hasOutdatedBrowser) {
          securityRiskLevel = 'high';
        } else if (securityIssuesCount >= 2) {
          securityRiskLevel = 'medium';
        } else {
          securityRiskLevel = 'low';
        }
      }

      // Behavior risk (12%) - tracking through user interactions
      const behaviorCat = categoryRates['behavior'];
      if (behaviorCat && behaviorCat.total > 0) {
        // Track behavior data points
        behaviorDataPoints = behaviorCat.confirmed;
        
        // Determine behavior risk level
        if (behaviorDataPoints >= 5) {
          behaviorRiskLevel = 'high';
        } else if (behaviorDataPoints >= 3) {
          behaviorRiskLevel = 'medium';
        } else {
          behaviorRiskLevel = 'low';
        }
      }
    }

    // MPC-7471-F4: the number is the shared exposure score; nothing here weighs categories any more. Provisional until every point is confirmed.
    const exposure = exposureForPage(hexagons ?? [], total > 0 && confirmed >= total);
    const percentage = exposure.score;

    return {
      percentage,
      band: exposure.band,
      provisional: exposure.provisional,
      hasFingerprint: hexagons?.some((h) => h.category === 'fingerprint' && h.confirmed) || false,
      fingerprintRisk: fingerprint?.totalRisk || null,
      hasSocial: hexagons?.some((h) => h.category === 'social' && h.confirmed) || false,
      socialRiskLevel,
      loggedInServices,
      hasSecurity: hexagons?.some((h) => h.category === 'security' && h.confirmed) || false,
      securityRiskLevel,
      securityIssuesCount,
      hasCriticalSecurity: hasDNSLeak || hasWebRTCLeak,
      hasBehavior: hexagons?.some((h) => h.category === 'behavior' && h.confirmed) || false,
      behaviorRiskLevel,
      behaviorDataPoints,
    };
  }, [confirmed, total, hexagons, fingerprint]);

  const { 
    percentage, 
    band,
    provisional,
    hasFingerprint, 
    fingerprintRisk, 
    hasSocial, 
    socialRiskLevel, 
    loggedInServices,
    hasSecurity,
    securityRiskLevel,
    securityIssuesCount,
    hasCriticalSecurity,
    hasBehavior,
    behaviorRiskLevel,
    behaviorDataPoints,
  } = riskData;
  
  const getRiskLevel = () => {
    if (band === 'high') return { label: BAND_LABEL.high, Icon: AlertCircle };
    if (band === 'medium') return { label: BAND_LABEL.medium, Icon: AlertTriangle };
    if (band === 'low') return { label: BAND_LABEL.low, Icon: Shield };
    return { label: 'Scanning...', Icon: Shield };
  };

  const risk = getRiskLevel();

  return (
    <div className="bg-surface/95 border border-surface-border rounded-xl p-4 sm:p-6 mx-2 sm:mx-auto mb-4 shadow-card max-w-[460px]">
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
              stroke="hsl(var(--risk-low) / 0.18)"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={byBand(band, 'hsl(var(--risk-high))', 'hsl(var(--risk-mid))', 'hsl(var(--risk-low))', 'hsl(var(--muted))')}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(percentage ?? 0) * 2.51} 251`}
              className="transition-all duration-500 ease-out"
              
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-xl sm:text-2xl font-bold", byBand(band, 'text-foreground', 'text-risk-mid', 'text-risk-low', 'text-muted-foreground'))}>
              {percentage ?? '–'}
            </span>
          </div>
        </div>

        {/* Risk Info */}
        <div className="flex-1 text-center sm:text-left">
          <div className={cn(
            "inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-semibold mb-2 border",
            byBand(band, "bg-risk-high-soft text-foreground border-risk-high/30", "bg-risk-mid-soft text-risk-mid border-risk-mid/30", "bg-risk-low-soft text-foreground border-risk-low/30", "bg-muted text-muted-foreground border-border")
          )}>
            <risk.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            {risk.label}{band && provisional ? ' (provisional)' : ''}
          </div>

          <div className="text-muted-foreground text-sm sm:text-base">
            <span className="font-medium text-risk-low">{confirmed}</span> of{' '}
            <span className="font-medium text-risk-low">{total}</span> data points confirmed
          </div>

          {/* Risk indicators row */}
          <div className="flex flex-wrap gap-2 mt-2 justify-center sm:justify-start">
            {/* Fingerprint indicator */}
            {hasFingerprint && fingerprintRisk && (
              <div className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                fingerprintRisk === 'high' ? "bg-risk-high-soft text-foreground border-risk-high/30" :
                fingerprintRisk === 'medium' ? "bg-risk-mid-soft text-risk-mid border-risk-mid/30" :
                "bg-risk-low-soft text-foreground border-risk-low/30"
              )}>
                <Fingerprint className="w-3 h-3" />
                FP: {fingerprintRisk.charAt(0).toUpperCase() + fingerprintRisk.slice(1)}
              </div>
            )}

            {/* Social tracking indicator */}
            {hasSocial && socialRiskLevel && (
              <div className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                socialRiskLevel === 'critical' ? "bg-risk-high-soft text-foreground border-risk-high/30" :
                socialRiskLevel === 'high' ? "bg-risk-orange-soft text-foreground border-risk-orange/30" :
                socialRiskLevel === 'medium' ? "bg-risk-mid-soft text-risk-mid border-risk-mid/30" :
                "bg-risk-low-soft text-foreground border-risk-low/30"
              )}>
                <Users className="w-3 h-3" />
                Social: {socialRiskLevel === 'critical' ? 'High' : loggedInServices > 0 ? `${loggedInServices} logged in` : 'Safe'}
              </div>
            )}

            {/* Security vulnerability indicator */}
            {hasSecurity && securityRiskLevel && (
              <div className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                securityRiskLevel === 'critical' ? "bg-risk-high-soft text-foreground border-risk-high/30" :
                securityRiskLevel === 'high' ? "bg-risk-orange-soft text-foreground border-risk-orange/30" :
                securityRiskLevel === 'medium' ? "bg-risk-mid-soft text-risk-mid border-risk-mid/30" :
                "bg-risk-low-soft text-foreground border-risk-low/30"
              )}>
                <ShieldAlert className="w-3 h-3" />
                Security: {securityRiskLevel === 'critical' ? 'Needs attention' : securityIssuesCount > 0 ? `${securityIssuesCount} issues` : 'Secure'}
              </div>
            )}

            {/* Behavior tracking indicator */}
            {hasBehavior && behaviorRiskLevel && (
              <div className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                behaviorRiskLevel === 'high' ? "bg-risk-mid-soft text-risk-mid border-risk-mid/30" :
                behaviorRiskLevel === 'medium' ? "bg-risk-mid-soft text-risk-mid border-risk-mid/30" :
                "bg-risk-low-soft text-foreground border-risk-low/30"
              )}>
                <Activity className="w-3 h-3" />
                Behavior: {behaviorDataPoints > 0 ? `${behaviorDataPoints} tracked` : 'Safe'}
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-2 sm:mt-3 h-1.5 sm:h-2 bg-risk-low/10 rounded-full overflow-hidden max-w-xs mx-auto sm:mx-0 border border-risk-low/20">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                byBand(band, "bg-risk-high", "bg-risk-mid", "bg-risk-low", "bg-muted")
              )}
              style={{ width: `${percentage ?? 0}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
