// Pure state transitions for the identity confirmation loop. No React, no I/O, so every rule is unit-tested.
//   guess   + yes -> confirmed       guess   + no -> false_positive
//   checked (confidence > DISPUTE_MIN_CONFIDENCE) + dispute -> disputed
// Anything else is a no-op: a finding the user already answered is not flipped by a later tap.
import type { Hexagon, ScanResult } from '@/types/hexagon';

export const DISPUTE_MIN_CONFIDENCE = 0.8;

export type LearningOutcome = 'confirmed' | 'rejected' | 'disputed';

/** What the engine may learn from one answer. Holds no `data` value: the finding's content never leaves the page. */
export interface LearningSignal {
  hexagonId: string;
  pillar: string;
  source: string | null;
  confidence_score: number | null;
  previousStatus: Hexagon['status'];
  outcome: LearningOutcome;
}

export interface TransitionResult {
  next: ScanResult;
  signal: LearningSignal | null;
}

export const canConfirm = (h: Hexagon) => h.status === 'guess';
export const canDispute = (h: Hexagon) =>
  h.status === 'checked' && (h.confidence_score ?? 0) > DISPUTE_MIN_CONFIDENCE;

function update(
  state: ScanResult,
  id: string,
  allowed: (h: Hexagon) => boolean,
  patch: Pick<Hexagon, 'status' | 'interaction_state'>,
  outcome: LearningOutcome,
): TransitionResult {
  const target = state.hexagons.find((h) => h.id === id);
  if (!target || !allowed(target)) return { next: state, signal: null };
  return {
    next: { ...state, hexagons: state.hexagons.map((h) => (h.id === id ? { ...h, ...patch } : h)) },
    signal: {
      hexagonId: target.id,
      pillar: target.pillar,
      source: target.source,
      confidence_score: target.confidence_score ?? null,
      previousStatus: target.status,
      outcome,
    },
  };
}

export const confirmHexagon = (state: ScanResult, id: string, isMatch: boolean): TransitionResult =>
  update(
    state,
    id,
    canConfirm,
    isMatch
      ? { status: 'confirmed', interaction_state: 'confirmed_by_user' }
      : { status: 'false_positive', interaction_state: 'rejected_by_user' },
    isMatch ? 'confirmed' : 'rejected',
  );

export const disputeHexagon = (state: ScanResult, id: string): TransitionResult =>
  update(state, id, canDispute, { status: 'disputed', interaction_state: 'disputed_by_user' }, 'disputed');

/**
 * The only hexagons that may feed the Risk Score: findings the engine is sure of, or the user owned up to.
 * Excluded: false_positive (user said not me), disputed (user says wrong), unanswered guesses, not_checked.
 * Use this, never `scanResult.hexagons`, as the score's input.
 */
const SCORED = new Set<Hexagon['status']>(['checked', 'given', 'confirmed']);
export const scoredHexagons = (state: ScanResult): Hexagon[] => state.hexagons.filter((h) => SCORED.has(h.status));
