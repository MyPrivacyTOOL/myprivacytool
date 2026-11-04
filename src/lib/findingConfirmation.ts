// Human-in-the-loop identity confirmation for OSINT findings ("Is this you?").
// Pure functions only: no React, no network, no storage. The UI (IdentityConfirmTile) and the hook
// (useIdentityConfirmation) both go through these, so the rules live in one place.
//
// Rules:
//   guess    -> confirmed | false_positive   (the user answers "Is this you?")
//   checked  -> disputed                     (only when confidence is above HIGH_CONFIDENCE)
//   anything else is left alone: the transition functions return the finding unchanged.
// Only what the user has not denied counts toward the risk score. A guess counts only once confirmed;
// false_positive and disputed never count. Nothing here ever invents a status for a not_checked finding.

export type FindingStatus =
  | 'checked'
  | 'given'
  | 'guess'
  | 'not_checked'
  | 'confirmed'
  | 'false_positive'
  | 'disputed';

export type InteractionState =
  | 'pending_confirmation'
  | 'confirmed_by_user'
  | 'rejected_by_user'
  | 'disputed_by_user';

export interface IdentityFinding {
  id: string;
  pillar: string;
  label: string;
  status: FindingStatus;
  /** The found value (an email, a breach name...). Never sent anywhere by this module. */
  data: string | null;
  /** Which provider or pivot produced it; this is what the learning loop groups by. */
  source: string | null;
  /** 0.0 to 1.0. */
  confidence_score?: number;
  remediation: string | null;
  interaction_state?: InteractionState;
}

/** A checked finding can be disputed only above this confidence. */
export const HIGH_CONFIDENCE = 0.8;

export type LearningDecision = 'confirmed' | 'rejected' | 'disputed';

/**
 * What the learning loop gets. Deliberately no `data`: the engine needs to know which provider was wrong
 * about which kind of finding, not what the person's email or number is.
 */
export interface LearningEvent {
  id: string;
  pillar: string;
  source: string | null;
  statusBefore: FindingStatus;
  confidence_score?: number;
  decision: LearningDecision;
}

export const needsConfirmation = (f: IdentityFinding): boolean => f.status === 'guess';

export const canDispute = (f: IdentityFinding): boolean =>
  f.status === 'checked' && (f.confidence_score ?? 0) > HIGH_CONFIDENCE;

/** User answered "Is this you?" on a guess. Any other status is returned unchanged. */
export function confirmFinding(f: IdentityFinding, isMatch: boolean): IdentityFinding {
  if (!needsConfirmation(f)) return f;
  return {
    ...f,
    status: isMatch ? 'confirmed' : 'false_positive',
    interaction_state: isMatch ? 'confirmed_by_user' : 'rejected_by_user',
  };
}

/** User says a high-confidence checked finding is not theirs. Any other finding is returned unchanged. */
export function disputeFinding(f: IdentityFinding): IdentityFinding {
  if (!canDispute(f)) return f;
  return { ...f, status: 'disputed', interaction_state: 'disputed_by_user' };
}

/** Does this finding count toward the person's risk score? */
export function countsTowardRisk(f: IdentityFinding): boolean {
  return f.status === 'checked' || f.status === 'given' || f.status === 'confirmed';
}

export function riskFindings(findings: readonly IdentityFinding[]): IdentityFinding[] {
  return findings.filter(countsTowardRisk);
}

export function learningEvent(before: IdentityFinding, after: IdentityFinding): LearningEvent | null {
  if (before === after) return null; // the transition was refused: nothing happened, nothing to learn
  const decision: LearningDecision =
    after.status === 'confirmed' ? 'confirmed' : after.status === 'disputed' ? 'disputed' : 'rejected';
  return {
    id: before.id,
    pillar: before.pillar,
    source: before.source,
    statusBefore: before.status,
    confidence_score: before.confidence_score,
    decision,
  };
}
