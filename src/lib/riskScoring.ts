/**
 * Risk Scoring Module — MPC-8302
 * Deterministic exposure risk calculation based on breach/paste data
 * 
 * Formula:
 * exposure_score = min(100, breach_count * 10 + paste_count * 5)
 * 
 * Interpretation:
 * - 0-20: Low risk (green)
 * - 21-50: Medium risk (yellow)
 * - 51-80: High risk (orange)
 * - 81-100: Critical risk (red)
 */

import { OsintLookupResult } from './osintLookup';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ExposureScore {
  score: number; // 0-100
  riskLevel: RiskLevel;
  breachContribution: number; // score from breaches
  pasteContribution: number; // score from pastes
  explanation: string;
  confidence: ConfidenceLevel;
}

export interface RiskMetrics {
  uniqueDataTypes: number; // number of different data categories exposed
  temporalRisk: string; // "recent" | "old" based on most recent breach
  uniqueBreaches: number; // count of distinct breaches
  commonDataClasses: string[]; // most common exposed data types
}

/**
 * Calculate exposure score deterministically
 * 
 * Formula:
 * - Breach score: breach_count * 10 (each breach adds 10 points)
 * - Paste score: paste_count * 5 (each paste adds 5 points)
 * - Total: min(100, breach_score + paste_score)
 */
export function calculateExposureScore(lookup: OsintLookupResult): ExposureScore {
  const breachContribution = Math.min(100, lookup.breachCount * 10);
  const pasteContribution = Math.min(100, lookup.pasteCount * 5);
  const rawScore = breachContribution + pasteContribution;
  const score = Math.min(100, rawScore);

  let riskLevel: RiskLevel;
  let explanation: string;

  if (score === 0) {
    riskLevel = 'low';
    explanation = 'No breaches or pastes detected for this value.';
  } else if (score <= 20) {
    riskLevel = 'low';
    explanation = `Low exposure: ${lookup.breachCount} breach(es) found. Monitor for changes.`;
  } else if (score <= 50) {
    riskLevel = 'medium';
    explanation = `Medium exposure: ${lookup.breachCount} breach(es) and ${lookup.pasteCount} paste(s) detected. Consider action.`;
  } else if (score <= 80) {
    riskLevel = 'high';
    explanation = `High exposure: Significant number of breaches (${lookup.breachCount}) and pastes (${lookup.pasteCount}). Action recommended.`;
  } else {
    riskLevel = 'critical';
    explanation = `Critical exposure: Very high risk. Immediate action required to protect this data point.`;
  }

  return {
    score,
    riskLevel,
    breachContribution,
    pasteContribution,
    explanation,
    confidence: lookup.confidence,
  };
}

/**
 * Extract risk metrics from breaches
 */
export function extractRiskMetrics(lookup: OsintLookupResult): RiskMetrics {
  // Collect all unique data classes
  const allDataClasses = new Set<string>();
  lookup.breaches.forEach(breach => {
    breach.dataClasses?.forEach(dc => allDataClasses.add(dc));
  });

  // Find most common data classes
  const classFrequency: Record<string, number> = {};
  lookup.breaches.forEach(breach => {
    breach.dataClasses?.forEach(dc => {
      classFrequency[dc] = (classFrequency[dc] || 0) + 1;
    });
  });

  const commonDataClasses = Object.entries(classFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([dc]) => dc);

  // Temporal risk: check if any breach is within last 90 days
  const now = new Date();
  const recentThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const hasRecentBreach = lookup.breaches.some(
    breach => new Date(breach.date) > recentThreshold
  );

  return {
    uniqueDataTypes: allDataClasses.size,
    temporalRisk: hasRecentBreach ? 'recent' : 'old',
    uniqueBreaches: lookup.breachCount,
    commonDataClasses,
  };
}

/**
 * Risk awareness state transition
 * Used to determine if user should see urgent vs reassuring messaging
 */
export type UserState = 'new' | 'at_risk' | 'protected' | 'recovering';

export interface RiskAwarenessTransition {
  currentState: UserState;
  previousState?: UserState;
  shouldEscalate: boolean;
  shouldReassure: boolean;
  messageTone: 'urgent' | 'neutral' | 'reassuring';
}

/**
 * Determine user state and message tone based on risk
 */
export function getStateTransition(
  score: ExposureScore,
  previousScore?: ExposureScore
): RiskAwarenessTransition {
  let currentState: UserState;
  let shouldEscalate = false;
  let shouldReassure = false;
  let messageTone: 'urgent' | 'neutral' | 'reassuring';

  // State logic
  if (score.riskLevel === 'critical' || score.riskLevel === 'high') {
    currentState = 'at_risk';
    shouldEscalate = true;
    messageTone = 'urgent';
  } else if (score.riskLevel === 'medium') {
    currentState = 'at_risk';
    messageTone = 'neutral';
  } else {
    currentState = 'protected';
    shouldReassure = true;
    messageTone = 'reassuring';
  }

  // Check if risk improved (recovering)
  if (previousScore && previousScore.score > score.score) {
    currentState = 'recovering';
    shouldReassure = true;
    messageTone = 'reassuring';
  }

  return {
    currentState,
    shouldEscalate,
    shouldReassure,
    messageTone,
  };
}

/**
 * Generate a brief risk summary for UI display
 */
export function generateRiskSummary(
  lookup: OsintLookupResult,
  score: ExposureScore
): string {
  const metrics = extractRiskMetrics(lookup);
  const { currentState, messageTone } = getStateTransition(score);

  const summaries: Record<string, string> = {
    'low-urgent': `⚠️ Your ${lookup.inputType} appears in ${lookup.breachCount} breach(es). While the risk is low, we recommend monitoring.`,
    'low-neutral': `✓ Your ${lookup.inputType} shows minimal exposure (${lookup.breachCount} breach(es)). Check back regularly.`,
    'low-reassuring': `✓ Good news: Your ${lookup.inputType} has low exposure risk. Keep practicing strong security habits.`,
    'medium-urgent': `⚠️ Your ${lookup.inputType} was found in ${lookup.breachCount} breach(es) and ${lookup.pasteCount} paste(s). Consider action.`,
    'medium-neutral': `⚠️ Moderate exposure detected for your ${lookup.inputType}. Review the breaches below.`,
    'medium-reassuring': `✓ Your exposure risk is improving. Your ${lookup.inputType} was in ${lookup.breachCount} incident(s).`,
    'high-urgent': `🔴 CRITICAL: Your ${lookup.inputType} is highly exposed (${lookup.breachCount} breach(es), ${lookup.pasteCount} paste(s)). Act now.`,
    'high-neutral': `🔴 High exposure: Your ${lookup.inputType} was in many breaches. Review & remediate.`,
    'high-reassuring': `✓ Recovering: Your exposure is decreasing. Continue taking protective steps.`,
    'critical-urgent': `🔴 CRITICAL RISK: Your ${lookup.inputType} is extremely exposed. Immediate action required.`,
  };

  const key = `${score.riskLevel}-${messageTone}`;
  return (
    summaries[key] ||
    `Your ${lookup.inputType} has a ${score.riskLevel} risk level (score: ${score.score}/100).`
  );
}

/**
 * Localization keys for risk messaging
 * Used by the response template engine (29 keys per spec)
 */
export const RISK_LOCALIZATION_KEYS = [
  'risk.score.label',
  'risk.level.low',
  'risk.level.medium',
  'risk.level.high',
  'risk.level.critical',
  'risk.breaches.found',
  'risk.pastes.found',
  'risk.no_exposure',
  'risk.take_action',
  'risk.review_breaches',
  'risk.change_passwords',
  'risk.monitor_accounts',
  'risk.freeze_credit',
  'risk.enable_2fa',
  'risk.data_types_exposed',
  'risk.temporal_recent',
  'risk.temporal_old',
  'risk.common_classes',
  'risk.reassure_low',
  'risk.escalate_high',
  'risk.escalate_critical',
  'risk.action_urgent',
  'risk.action_suggested',
  'risk.action_optional',
  'risk.next_steps',
  'risk.learn_more',
  'risk.protect_yourself',
  'risk.breaches_detail',
  'risk.summary',
] as const;

/**
 * Validate localization keys
 */
export function validateLocalizationKeys(keys: string[]): boolean {
  const validKeys = new Set(RISK_LOCALIZATION_KEYS);
  return keys.every(key => validKeys.has(key));
}
