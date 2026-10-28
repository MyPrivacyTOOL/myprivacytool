import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertCircle, Fingerprint, Users, ShieldAlert, Activity } from 'lucide-react';
import { HexagonData } from '@/lib/deviceDetection';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';
import { scanCountsLine, type ScanCounts } from '../../shared/hexagon-registry/counts.js';
import { footprintSummary, footprintLine, footprintChannelsLine } from '../../shared/hexagon-registry/footprint.js';
import { useTelegramHandoff } from '@/lib/telegramHandoff';
import { useWebExtras } from '@/hooks/useWebExtras';
import { checkedExtraIds } from '@/lib/webExtras';
import { computePageRisk, getPageRiskLabel } from '@/lib/scanResult';
import { byBand } from '@/lib/exposureScore';

interface RiskScoreProps {
  /** The ring's input (unchanged by MPC-7471-F2): confirmed taps out of the hexagons revealed so far. */
  confirmed: number;
  total: number;
  /** MPC-7471-F2: confirmed (X), checked (Y) and total (Z), from the registry. Words only; the ring does not use it. */
  counts: ScanCounts;
  hexagons?: HexagonData[];
  fingerprint?: CompositeFingerprint | null;
}

export default function RiskScore({ confirmed, total, counts, hexagons, fingerprint }: RiskScoreProps) {
  const handoff = useTelegramHandoff(); // MPC-8689: Telegram's checked ids when the page was opened from the one-time link, else none
  const webExtras = useWebExtras(); // MPC-8689 pilot: extra connection checks, off unless VITE_WEB_EXTRAS=true, never in the score or scanCounts
  const extraIds = useMemo(() => checkedExtraIds(webExtras), [webExtras]);
  const footprint = useMemo(() => footprintSummary([...counts.checkedIds, ...handoff.ids, ...extraIds]), [counts.checkedIds, handoff.ids, extraIds]);
  // MPC-7471-F4: the score and band come from the shared exposure contract via computePageRisk; provisional until every point is confirmed.
  const riskData = useMemo(
    () => computePageRisk({ confirmed, total, hexagons, fingerprint, scanTotal: counts.total }),
    [confirmed, total, hexagons, fingerprint, counts.total],
  );

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
    const label = getPageRiskLabel(percentage);
    if (band === 'high') return { label, Icon: AlertCircle };
    if (band === 'medium') return { label, Icon: AlertTriangle };
    return { label, Icon: Shield };
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

          <div className="text-muted-foreground text-sm sm:text-base" data-testid="scan-counts-line">
            {scanCountsLine(counts)}
          </div>
          {/* MPC-8689: the whole footprint, so a visitor sees how much is still to review, not only the web hexagons. Only hexagons whose check ran count as checked. */}
          <div className="text-muted-foreground text-xs sm:text-sm mt-1" data-testid="footprint-line">
            {footprintLine(footprint)}
            {footprintChannelsLine(footprint) && ` (${footprintChannelsLine(footprint)})`}
            {handoff.ids.length > 0 && ` Telegram part from your Telegram scan${handoff.scanAt ? ` on ${new Date(handoff.scanAt).toLocaleDateString()}` : ''}.`}
            {' '}<a href="/hexagon/" className="underline">See all {footprint.total}</a>
          </div>
          {webExtras.length > 0 && (
            <details className="text-muted-foreground text-xs sm:text-sm mt-1" data-testid="web-extras">
              <summary className="cursor-pointer">Extra connection checks (not part of your score)</summary>
              <ul className="mt-1 space-y-1">
                {webExtras.map((x) => (
                  <li key={x.id}><span className="font-medium">{x.label}:</span> {x.status === 'not_checked' ? `not checked (${x.reason})` : x.status === 'clear' ? 'nothing found' : x.value}</li>
                ))}
              </ul>
            </details>
          )}

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
