/**
 * Risk Response Template Engine — MPC-8302
 * Generates structured JSON responses with risk-aware messaging
 * 
 * Output Format:
 * {
 *   risk_summary: { score, level, explanation, next_steps },
 *   risk_metadata: { exposure_types, common_data_classes, temporal_info },
 *   localization_keys: [ array of 29 risk.* keys ],
 *   state_transition: { new -> risk_aware }
 * }
 */

import { OsintLookupResult } from './osintLookup';
import {
  calculateExposureScore,
  extractRiskMetrics,
  generateRiskSummary,
  getStateTransition,
  RISK_LOCALIZATION_KEYS,
  RiskAwarenessTransition,
} from './riskScoring';

export interface NextStep {
  priority: 'immediate' | 'high' | 'medium' | 'low';
  action: string;
  reason: string;
  localization_key: string;
}

export type ResponseLevel = 'low' | 'medium' | 'high' | 'critical' | 'not_checked';

export interface RiskSummaryResponse {
  /** "checked" lookups carry a score; "not_checked" ones never do (we do not guess). */
  status: 'checked' | 'not_checked';
  /** Why nothing was checked (unsupported_type | no_api_key | rate_limited | timeout | upstream_error). */
  reason?: string;
  score: number | null;
  level: ResponseLevel;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  explanation: string;
  next_steps: NextStep[];
  exposure_types: string[];
  exposure_count: {
    breaches: number;
    pastes: number;
    total: number;
  };
  temporal_info: {
    risk: 'recent' | 'old';
    last_checked: string;
  };
  localization_keys: typeof RISK_LOCALIZATION_KEYS;
  state_transition: RiskAwarenessTransition;
}

/**
 * Generate risk-aware next steps based on risk level
 */
function generateNextSteps(
  lookup: OsintLookupResult,
  score: number,
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
): NextStep[] {
  const steps: NextStep[] = [];

  // Critical: immediate action required
  if (riskLevel === 'critical') {
    steps.push({
      priority: 'immediate',
      action: 'Change passwords for all affected accounts',
      reason: 'Your data has been compromised in multiple breaches',
      localization_key: 'risk.change_passwords',
    });
    steps.push({
      priority: 'immediate',
      action: 'Enable two-factor authentication (2FA)',
      reason: 'Adds an extra layer of security to prevent account takeover',
      localization_key: 'risk.enable_2fa',
    });
    steps.push({
      priority: 'high',
      action: 'Monitor credit reports and set fraud alerts',
      reason: 'Protect yourself from identity theft',
      localization_key: 'risk.freeze_credit',
    });
  }

  // High: urgent action
  if (riskLevel === 'high') {
    steps.push({
      priority: 'high',
      action: 'Change passwords for compromised accounts',
      reason: `Your ${lookup.inputType} appears in ${lookup.breachCount} breach(es)`,
      localization_key: 'risk.change_passwords',
    });
    steps.push({
      priority: 'high',
      action: 'Enable 2FA on important accounts',
      reason: 'Prevent unauthorized access even if passwords are compromised',
      localization_key: 'risk.enable_2fa',
    });
    steps.push({
      priority: 'medium',
      action: 'Review exposed data types and take specific action',
      reason: 'Different data types require different protective measures',
      localization_key: 'risk.review_breaches',
    });
  }

  // Medium: suggested action
  if (riskLevel === 'medium') {
    steps.push({
      priority: 'medium',
      action: 'Review the breaches affecting this data point',
      reason: 'Understand what information was exposed',
      localization_key: 'risk.review_breaches',
    });
    steps.push({
      priority: 'medium',
      action: 'Update passwords on affected accounts',
      reason: 'Preventive measure for potentially compromised accounts',
      localization_key: 'risk.change_passwords',
    });
    steps.push({
      priority: 'low',
      action: 'Monitor your accounts for suspicious activity',
      reason: 'Catch any unauthorized access early',
      localization_key: 'risk.monitor_accounts',
    });
  }

  // Low: optional/educational
  if (riskLevel === 'low') {
    steps.push({
      priority: 'low',
      action: 'Maintain good security practices',
      reason: 'Keep your exposure score low by using strong, unique passwords',
      localization_key: 'risk.protect_yourself',
    });
    steps.push({
      priority: 'low',
      action: 'Check back regularly',
      reason: 'New breaches are discovered all the time',
      localization_key: 'risk.monitor_accounts',
    });
  }

  return steps;
}

/**
 * Format breach data for response
 */
function formatExposureTypes(lookup: OsintLookupResult): string[] {
  const metrics = extractRiskMetrics(lookup);
  return metrics.commonDataClasses.length > 0
    ? metrics.commonDataClasses
    : ['Email address', 'Account information'];
}

function generateNotCheckedResponse(lookup: OsintLookupResult): RiskSummaryResponse {
  return {
    status: 'not_checked',
    reason: lookup.reason,
    score: null,
    level: 'not_checked',
    confidence: 'low',
    summary: `We could not check your ${lookup.inputType} right now, so we have no score for it.`,
    explanation:
      'This is not a clean result. The check did not run, so we are not saying anything about your exposure.',
    next_steps: [],
    exposure_types: [],
    exposure_count: { breaches: 0, pastes: 0, total: 0 },
    temporal_info: { risk: 'old', last_checked: lookup.timestamp },
    localization_keys: RISK_LOCALIZATION_KEYS,
    state_transition: { currentState: 'new', shouldEscalate: false, shouldReassure: false, messageTone: 'neutral' },
  };
}

/**
 * Generate the full risk response
 * Main entry point for response template engine
 */
export function generateRiskResponse(
  lookup: OsintLookupResult
): RiskSummaryResponse {
  if (lookup.status === 'not_checked') return generateNotCheckedResponse(lookup);
  const score = calculateExposureScore(lookup);
  const metrics = extractRiskMetrics(lookup);
  const stateTransition = getStateTransition(score);
  const summary = generateRiskSummary(lookup, score);
  const nextSteps = generateNextSteps(
    lookup,
    score.score,
    score.riskLevel
  );

  return {
    status: 'checked',
    score: score.score,
    level: score.riskLevel,
    confidence: score.confidence,
    summary,
    explanation: score.explanation,
    next_steps: nextSteps,
    exposure_types: formatExposureTypes(lookup),
    exposure_count: {
      breaches: lookup.breachCount,
      pastes: lookup.pasteCount,
      total: lookup.breachCount + lookup.pasteCount,
    },
    temporal_info: {
      risk: metrics.temporalRisk as 'recent' | 'old',
      last_checked: lookup.timestamp,
    },
    localization_keys: RISK_LOCALIZATION_KEYS,
    state_transition: stateTransition,
  };
}

/**
 * Generate a compact risk card (for UI display)
 */
export interface RiskCard {
  title: string;
  score: number | null;
  level: ResponseLevel;
  color: string;
  icon: string;
  primaryCTA: string;
  secondaryCTA?: string;
}

export function generateRiskCard(response: RiskSummaryResponse): RiskCard {
  const colorMap: Record<string, string> = {
    low: '#10b981',
    medium: '#f59e0b',
    high: '#ef4444',
    critical: '#7f1d1d',
    not_checked: '#6b7280',
  };

  const iconMap: Record<string, string> = {
    low: '✓',
    medium: '⚠️',
    high: '🔴',
    critical: '🔴',
    not_checked: '?',
  };

  const ctaMap: Record<string, string> = {
    low: 'Monitor',
    medium: 'Review',
    high: 'Take Action',
    critical: 'Act Now',
    not_checked: 'Try Again',
  };

  return {
    title: response.level === 'not_checked' ? 'Not checked' : `Exposure: ${response.level.charAt(0).toUpperCase() + response.level.slice(1)}`,
    score: response.score,
    level: response.level,
    color: colorMap[response.level],
    icon: iconMap[response.level],
    primaryCTA: ctaMap[response.level],
    secondaryCTA: response.level === 'low' || response.level === 'not_checked' ? undefined : 'View Details',
  };
}

/**
 * Validate response structure
 */
export function validateRiskResponse(response: unknown): response is RiskSummaryResponse {
  if (!response || typeof response !== 'object') return false;

  const r = response as Record<string, unknown>;
  return (
    ['checked', 'not_checked'].includes(r.status as string) &&
    (typeof r.score === 'number' || (r.status === 'not_checked' && r.score === null)) &&
    ['low', 'medium', 'high', 'critical', 'not_checked'].includes(r.level as string) &&
    ['high', 'medium', 'low'].includes(r.confidence as string) &&
    typeof r.summary === 'string' &&
    typeof r.explanation === 'string' &&
    Array.isArray(r.next_steps) &&
    Array.isArray(r.exposure_types) &&
    typeof r.exposure_count === 'object' &&
    typeof r.temporal_info === 'object' &&
    Array.isArray(r.localization_keys) &&
    typeof r.state_transition === 'object'
  );
}

/**
 * Export response to JSON (for API/storage)
 */
export function serializeRiskResponse(response: RiskSummaryResponse): string {
  return JSON.stringify(response, null, 2);
}

/**
 * Parse JSON response back to typed object
 */
export function deserializeRiskResponse(json: string): RiskSummaryResponse {
  const parsed = JSON.parse(json);
  if (!validateRiskResponse(parsed)) {
    throw new Error('Invalid risk response structure');
  }
  return parsed;
}
