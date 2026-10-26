import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertCircle, Fingerprint, Users, ShieldAlert, Activity } from 'lucide-react';
import { HexagonData } from '@/lib/deviceDetection';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';
import { computePageRisk, getPageRiskLabel } from '@/lib/scanResult';

interface RiskScoreProps {
  confirmed: number;
  total: number;
  hexagons?: HexagonData[];
  fingerprint?: CompositeFingerprint | null;
}

export default function RiskScore({ confirmed, total, hexagons, fingerprint }: RiskScoreProps) {
  // Calculate weighted risk score with all categories including security and behavior
  const riskData = useMemo(
    () => computePageRisk({ confirmed, total, hexagons, fingerprint }),
    [confirmed, total, hexagons, fingerprint],
  );

  const { 
    percentage, 
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
  
  const getRiskLevel = (pct: number) => {
    const label = getPageRiskLabel(pct);
    if (label === 'High Risk') return { label, Icon: AlertCircle };
    if (label === 'Medium Risk') return { label, Icon: AlertTriangle };
    return { label, Icon: Shield };
  };

  const risk = getRiskLevel(percentage);

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
              stroke={percentage >= 80 ? 'hsl(var(--risk-high))' : percentage >= 50 ? 'hsl(var(--risk-mid))' : 'hsl(var(--risk-low))'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.51} 251`}
              className="transition-all duration-500 ease-out"
              
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-xl sm:text-2xl font-bold", percentage >= 80 ? 'text-foreground' : percentage >= 50 ? 'text-risk-mid' : 'text-risk-low')}>
              {percentage}%
            </span>
          </div>
        </div>

        {/* Risk Info */}
        <div className="flex-1 text-center sm:text-left">
          <div className={cn(
            "inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-semibold mb-2 border",
            percentage >= 80 ? "bg-risk-high-soft text-foreground border-risk-high/30" : 
            percentage >= 50 ? "bg-risk-mid-soft text-risk-mid border-risk-mid/30" : 
            "bg-risk-low-soft text-foreground border-risk-low/30"
          )}>
            <risk.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            {risk.label}
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
                percentage >= 80 ? "bg-risk-high" : percentage >= 50 ? "bg-risk-mid" : "bg-risk-low"
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
