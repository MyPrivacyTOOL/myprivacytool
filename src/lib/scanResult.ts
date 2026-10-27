// MPC-7471-F1: the ONE page risk result. RiskScore (the page card) and the scan-complete dialog / summary both read it, so the
// number and the label cannot differ.
// MPC-7471-F4: the number, band and coverage are the shared exposure contract (shared/hexagon-registry/score.js, docs/exposure-score-spec.md).
// This file no longer weighs categories or holds thresholds; it only derives the display flags (social, security, behaviour levels).
import { HexagonData } from '@/lib/deviceDetection';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';
import { exposureForPage } from '@/lib/exposureScore';
import { bandFor, BAND_LABEL } from '../../shared/hexagon-registry/score.js';

export interface PageRiskInput {
  confirmed: number;
  total: number;
  hexagons?: HexagonData[];
  fingerprint?: CompositeFingerprint | null;
  /** Z from the scan counts (MPC-7471-F2), used as the coverage total. */
  scanTotal?: number;
}

export type RiskLabel = 'High exposure' | 'Medium exposure' | 'Low exposure' | 'Scanning...' | 'Not enough checked to score';

// The band comes from the one shared definition (Low 0-39, Medium 40-69, High 70-100). No score yet reads "Scanning..." while a scan runs;
// pass complete = true for a finished scan, where no score means nothing could be checked, which is never shown as Low.
export function getPageRiskLabel(pct: number | null, complete = false): RiskLabel {
  const band = pct === null ? null : bandFor(Math.round(pct));
  if (band) return BAND_LABEL[band] as RiskLabel;
  return complete ? 'Not enough checked to score' : 'Scanning...';
}

export function computePageRisk({ confirmed, total, hexagons, fingerprint, scanTotal }: PageRiskInput) {
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

  // Provisional until every point is confirmed. Null = nothing could be checked yet: no score, never 0.
  const exposure = exposureForPage(hexagons ?? [], total > 0 && confirmed >= total, scanTotal);

  return {
    percentage: exposure.score,
    band: exposure.band,
    provisional: exposure.provisional,
    exposure,
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
}
