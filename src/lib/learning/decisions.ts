// CK-8493: the explicit human decision between "the answers suggest X" (measure.ts) and "a new confidence is in force" (confidence_config).
// A decision is an immutable header (hypothesis, baseline, bounded change, guardrails, evidence, owner, next check) plus an APPEND-ONLY list of
// events (decided, approved, rejected, implemented, rolled_back, outcome_checked). State is always derived from the events; nothing is edited and
// raw observations are never touched. Nothing here changes live configuration: "implemented" only RECORDS that an approved confidence_config
// version was put in force by whoever holds that authority.
// Approvals (agreed 2026-10-19, MPC-7915): Chris approves each change; the 80% dispute threshold also needs a different, second approver.
// Who that second approver is has not been decided, so the policy fails closed until one is named.
import { wilson, MIN_RESPONDERS } from './aggregate';
import type { Cohort } from './measure';

export const POLICY_VERSION = 'ck-8493-approval-policy-v1';

export type Decision = 'keep' | 'change' | 'stop' | 'insufficient_evidence';
export type TargetKind = 'confidence' | 'dispute_threshold';

export interface ApprovalPolicy {
  primaryApprover: string;
  /** People allowed to give the extra approval for the dispute threshold. Empty = such a change cannot be approved yet. */
  secondApprovers: readonly string[];
  version: string;
}
export const DEFAULT_POLICY: ApprovalPolicy = { primaryApprover: 'chris', secondApprovers: [], version: POLICY_VERSION };

export interface Guardrail { name: string; description: string }

export interface DecisionHeader {
  id: string;
  createdAt: number;
  owner: string;
  hypothesis: string;
  target: { kind: TargetKind; hexagonId: string; source: string; tileKind: string | null };
  /** Counts only. No person key, no finding value. */
  baseline: {
    windowStart: number; windowEnd: number; configVersion: number; cohortKey: string; inputDigest: string; rulesVersion: string;
    responders: number; responseRate: number; yesMe: number; notMe: number; disputed: number; kept: number; confidenceShown: number | null;
  };
  /** The one bounded change: from the confidence shown to a proposed value, never outside [min, max]. */
  proposedChange: { from: number; to: number; min: number; max: number };
  guardrails: readonly Guardrail[];
  evidence: { proposalId: string | null; basis: 'accuracy' | 'dispute' | 'unknown'; note: string };
  nextOutcomeCheckDue: number;
  policyVersion: string;
}

export type DecisionEvent =
  | { kind: 'decided'; at: number; by: string; decision: Decision; reason: string }
  | { kind: 'approved'; at: number; by: string }
  | { kind: 'rejected'; at: number; by: string; reason: string }
  | { kind: 'implemented'; at: number; by: string; configVersion: number }
  | { kind: 'rolled_back'; at: number; by: string; toConfigVersion: number; reason: string }
  | { kind: 'outcome_checked'; at: number; by: string; check: OutcomeCheck };

export type DecisionStatus = 'open' | 'decided_no_change' | 'awaiting_approval' | 'approved' | 'rejected' | 'implemented' | 'rolled_back';

export interface DecisionState {
  status: DecisionStatus;
  decision: Decision | null;
  approvals: string[];
  missingApprovals: string[];
  implementedConfigVersion: number | null;
  rolledBackToVersion: number | null;
  outcomeChecks: OutcomeCheck[];
  /** The version whose results the next outcome check should read. */
  versionToMeasure: number | null;
}

export class DecisionError extends Error {}

export const lc = (s: string) => s.trim().toLowerCase();

/** Who must approve this decision before it can be implemented. A missing second approver is reported, never assumed. */
export function requiredApprovals(h: DecisionHeader, p: ApprovalPolicy = DEFAULT_POLICY): { primary: string; secondRequired: boolean } {
  return { primary: lc(p.primaryApprover), secondRequired: h.target.kind === 'dispute_threshold' };
}

export function reduce(h: DecisionHeader, events: readonly DecisionEvent[], p: ApprovalPolicy = DEFAULT_POLICY): DecisionState {
  const need = requiredApprovals(h, p);
  const st: DecisionState = { status: 'open', decision: null, approvals: [], missingApprovals: [], implementedConfigVersion: null, rolledBackToVersion: null, outcomeChecks: [], versionToMeasure: null };
  for (const e of events) {
    if (e.kind === 'decided') { st.decision = e.decision; st.status = e.decision === 'change' ? 'awaiting_approval' : 'decided_no_change'; }
    else if (e.kind === 'approved') { if (!st.approvals.includes(lc(e.by))) st.approvals.push(lc(e.by)); }
    else if (e.kind === 'rejected') st.status = 'rejected';
    else if (e.kind === 'implemented') { st.status = 'implemented'; st.implementedConfigVersion = e.configVersion; st.versionToMeasure = e.configVersion; }
    else if (e.kind === 'rolled_back') { st.status = 'rolled_back'; st.rolledBackToVersion = e.toConfigVersion; st.versionToMeasure = e.toConfigVersion; }
    else if (e.kind === 'outcome_checked') st.outcomeChecks.push(e.check);
  }
  if (st.status === 'awaiting_approval' || st.status === 'approved') {
    const missing: string[] = [];
    if (!st.approvals.includes(need.primary)) missing.push(`primary approver (${need.primary})`);
    if (need.secondRequired && !st.approvals.some((a) => a !== need.primary && p.secondApprovers.map(lc).includes(a))) missing.push('second approver (dispute threshold)');
    st.missingApprovals = missing;
    st.status = missing.length === 0 ? 'approved' : 'awaiting_approval';
  }
  return st;
}

/** Checks whether `event` may be appended to `events`. Throws DecisionError with the reason; the caller persists only what passes. */
export function assertCanAppend(h: DecisionHeader, events: readonly DecisionEvent[], event: DecisionEvent, p: ApprovalPolicy = DEFAULT_POLICY): void {
  const st = reduce(h, events, p);
  const need = requiredApprovals(h, p);
  const by = lc(event.by);
  if (!by) throw new DecisionError('every event names who made it');
  if (st.status === 'rejected') throw new DecisionError('a rejected decision takes no further events');
  switch (event.kind) {
    case 'decided':
      if (st.decision) throw new DecisionError('a decision is recorded once; a new one is a new record');
      if (!event.reason.trim()) throw new DecisionError('a decision needs a reason');
      if (event.decision === 'change') {
        const { from, to, min, max } = h.proposedChange;
        if (!(min <= to && to <= max) || from === to) throw new DecisionError('a change must be a real move inside its stated bounds');
        if (h.evidence.basis === 'unknown') throw new DecisionError('no change can rest on evidence of unknown basis');
      }
      return;
    case 'approved':
    case 'rejected': {
      if (st.status !== 'awaiting_approval' && st.status !== 'approved') throw new DecisionError('only a decision to change awaits approval');
      const isSecond = p.secondApprovers.map(lc).includes(by);
      if (by !== need.primary && !(need.secondRequired && isSecond)) throw new DecisionError(`${event.by} is not an approver for this decision`);
      if (event.kind === 'approved' && st.approvals.includes(by)) throw new DecisionError('already approved by this person: one approval per person');
      if (event.kind === 'rejected' && !event.reason.trim()) throw new DecisionError('a rejection needs a reason');
      return;
    }
    case 'implemented':
      if (st.status !== 'approved') throw new DecisionError(`cannot record an implementation: ${st.missingApprovals.length ? 'missing ' + st.missingApprovals.join(' and ') : 'not an approved change'}`);
      if (!Number.isInteger(event.configVersion) || event.configVersion <= h.baseline.configVersion) throw new DecisionError('the implemented version must be a new confidence_config version');
      return;
    case 'rolled_back':
      if (st.status !== 'implemented') throw new DecisionError('only an implemented change can be rolled back');
      if (!event.reason.trim()) throw new DecisionError('a rollback needs a reason');
      return;
    case 'outcome_checked':
      if (st.status !== 'implemented' && st.status !== 'rolled_back') throw new DecisionError('an outcome check needs an implemented (or rolled-back) version to measure');
      if (event.check.configVersion !== st.versionToMeasure) throw new DecisionError('the check must read the version currently in force');
      return;
  }
}

/** Builds a decision header from a measured cohort. Only a cohort with a proposal, or an explicit insufficient-evidence hypothesis, can start one. */
export function headerFromCohort(c: Cohort, init: {
  id: string; now: number; owner: string; hypothesis: string; windowStart: number; windowEnd: number; inputDigest: string; rulesVersion: string;
  proposalId?: string | null; guardrails: readonly Guardrail[]; nextOutcomeCheckDue: number; bounds?: { min: number; max: number };
  targetKind?: TargetKind; policy?: ApprovalPolicy;
}): DecisionHeader {
  if (!init.owner.trim()) throw new DecisionError('a decision has an owner');
  if (!init.hypothesis.trim()) throw new DecisionError('a decision starts from a hypothesis');
  if (init.guardrails.length === 0) throw new DecisionError('a decision names at least one guardrail');
  if (init.nextOutcomeCheckDue <= init.now) throw new DecisionError('the next outcome check must be dated in the future');
  const from = c.confidenceShown ?? 0;
  const to = c.proposal?.proposed ?? from;
  const bounds = init.bounds ?? { min: Math.min(from, to), max: Math.max(from, to) };
  return {
    id: init.id, createdAt: init.now, owner: init.owner, hypothesis: init.hypothesis,
    target: { kind: init.targetKind ?? 'confidence', hexagonId: c.hexagonId, source: c.source, tileKind: c.tileKind },
    baseline: {
      windowStart: init.windowStart, windowEnd: init.windowEnd, configVersion: c.configVersion, cohortKey: c.key, inputDigest: init.inputDigest, rulesVersion: init.rulesVersion,
      responders: c.summary.responders, responseRate: c.summary.responseRate, yesMe: c.summary.yesMe, notMe: c.summary.notMe, disputed: c.summary.disputed, kept: c.summary.kept, confidenceShown: c.confidenceShown,
    },
    proposedChange: { from, to, ...bounds },
    guardrails: init.guardrails,
    evidence: { proposalId: init.proposalId ?? null, basis: c.basis, note: c.proposal ? c.proposal.note : `Report-only: ${c.warnings.map((x) => x.code).join(', ') || 'no proposal'}.` },
    nextOutcomeCheckDue: init.nextOutcomeCheckDue, policyVersion: (init.policy ?? DEFAULT_POLICY).version,
  };
}

// ---------- follow-up outcome check ----------

export type OutcomeResult = 'insufficient_evidence' | 'calibrated' | 'still_miscalibrated';

export interface OutcomeCheck {
  configVersion: number;
  windowStart: number;
  windowEnd: number;
  inputDigest: string;
  responders: number;
  responseRate: number;
  /** The confidence now shown for this tile and version. */
  confidenceShown: number | null;
  /** What the follow-up answers say that confidence should be, as a 95% Wilson interval on the confidence scale. */
  observedConfidence: { low: number; high: number } | null;
  /** Baseline interval on the same scale, for reference. */
  baselineConfidence: { low: number; high: number } | null;
  /** Whether the follow-up and baseline intervals are separable. Descriptive only. */
  separableFromBaseline: boolean | null;
  result: OutcomeResult;
  /** Always false: a before/after comparison of self-selected answers is not a causal estimate. */
  causal: false;
  guardrails: Array<{ name: string; held: boolean | null }>;
  note: string;
}

const toConfidence = (basis: 'accuracy' | 'dispute', iv: { low: number; high: number }) => basis === 'accuracy' ? { low: iv.low, high: iv.high } : { low: 1 - iv.high, high: 1 - iv.low };

/**
 * Compares the follow-up cohort (the version now in force) with the baseline in the header. The question is calibration: does the confidence now
 * shown sit inside the interval the follow-up answers support? Sparse or flagged data stays "insufficient evidence". Never a causal claim, and
 * a guardrail that was not measured is reported as unknown (held: null), not as held.
 */
export function outcomeCheck(h: DecisionHeader, followUp: Cohort | undefined, win: { start: number; end: number; inputDigest: string }, guardrailResults: Record<string, boolean | null> = {}): OutcomeCheck {
  const b = h.baseline;
  const basis = h.evidence.basis;
  const baseIv = basis === 'accuracy' ? wilson(b.yesMe, b.yesMe + b.notMe) : basis === 'dispute' ? wilson(b.disputed, b.disputed + b.kept) : null;
  const baselineConfidence = baseIv && basis !== 'unknown' ? toConfidence(basis, baseIv) : null;
  const guardrails = h.guardrails.map((g) => ({ name: g.name, held: guardrailResults[g.name] ?? null }));
  const base = { windowStart: win.start, windowEnd: win.end, inputDigest: win.inputDigest, causal: false as const, guardrails, baselineConfidence };
  if (!followUp) return { ...base, configVersion: -1, responders: 0, responseRate: 0, confidenceShown: null, observedConfidence: null, separableFromBaseline: null, result: 'insufficient_evidence', note: 'No follow-up data for this tile and version. Missing data is unknown, not improvement.' };
  const s = followUp.summary;
  const iv = basis === 'accuracy' ? s.accuracy : basis === 'dispute' ? s.disputeRate : null;
  const observedConfidence = iv && basis !== 'unknown' ? toConfidence(basis, iv) : null;
  const separable = observedConfidence && baselineConfidence ? (observedConfidence.high < baselineConfidence.low || baselineConfidence.high < observedConfidence.low) : null;
  const common = { ...base, configVersion: followUp.configVersion, responders: s.responders, responseRate: s.responseRate, confidenceShown: followUp.confidenceShown, observedConfidence, separableFromBaseline: separable };
  const flagged = followUp.warnings.some((x) => x.blocking);
  if (!observedConfidence || followUp.confidenceShown === null || s.responders < MIN_RESPONDERS || flagged) {
    return { ...common, result: 'insufficient_evidence', note: `Follow-up has ${s.responders} of ${MIN_RESPONDERS} responders${flagged ? ' and data-quality warnings' : ''}: descriptive only.` };
  }
  const inside = followUp.confidenceShown >= observedConfidence.low && followUp.confidenceShown <= observedConfidence.high;
  return {
    ...common, result: inside ? 'calibrated' : 'still_miscalibrated',
    note: 'Observational check of the confidence shown against self-selected answers; it does not show the change caused anything.',
  };
}
