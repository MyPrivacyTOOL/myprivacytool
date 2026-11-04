import { describe, it, expect } from 'vitest';
import { measure, type LedgerEvent, type MeasurementReport } from './measure';
import { headerFromCohort, outcomeCheck, reduce, DecisionError, type ApprovalPolicy, type DecisionHeader } from './decisions';
import { MemoryDecisionStore } from './decisionStore';
import { renderReview, dueChecks } from './review';
import { cohortEvents, T0, DAY } from './fixtures';

const NOW = T0 + 10 * DAY;
const window1 = { now: NOW, windowStart: T0, windowEnd: NOW };
const guard = [{ name: 'honesty', description: 'No stronger claim than the answers support' }];
// SYNTHETIC: 100 people shown a guess at 0.95; 60 answered, 15 said yes, 45 said not me.
const baseline = () => cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95, configVersion: 0, prefix: 'g', yes: 15, no: 45, silent: 40, at: T0 + DAY });
const policy: ApprovalPolicy = { primaryApprover: 'chris', secondApprovers: ['second-approver-synthetic'], version: 'test-policy' };

function proposalHeader(report: MeasurementReport, over: Partial<Parameters<typeof headerFromCohort>[1]> = {}): DecisionHeader {
  const c = report.cohorts.find((x) => x.status === 'proposal_candidate')!;
  return headerFromCohort(c, { id: 'dec-1', now: NOW, owner: 'chris', hypothesis: 'SYNTHETIC: 0.95 overstates how often the guess is right', windowStart: report.window.start, windowEnd: report.window.end, inputDigest: report.inputDigest, rulesVersion: report.rulesVersion, guardrails: guard, nextOutcomeCheckDue: NOW + 14 * DAY, policy, ...over });
}

describe('decision workflow: SYNTHETIC end-to-end trace', () => {
  it('evidence -> proposal -> explicit review -> versioned change -> follow-up outcome, read back from stored state', () => {
    const store = new MemoryDecisionStore(policy);
    const report = measure(baseline(), window1);
    const h = proposalHeader(report);
    store.create(h);
    expect(h.proposedChange).toMatchObject({ from: 0.95, to: 0.25 });

    // Nothing happens without review.
    expect(() => store.append('dec-1', { kind: 'implemented', at: NOW, by: 'claude', configVersion: 1 })).toThrow(/cannot record an implementation/);

    store.append('dec-1', { kind: 'decided', at: NOW + 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC: interval 0.16-0.37 excludes 0.95' });
    expect(reduce(store.read('dec-1')!.header, store.read('dec-1')!.events, policy).status).toBe('awaiting_approval');
    store.append('dec-1', { kind: 'approved', at: NOW + 2, by: 'Chris' });
    store.append('dec-1', { kind: 'implemented', at: NOW + 3, by: 'chris', configVersion: 1 });

    // Follow-up under version 1: the tile now shows 0.25 and people answer the same way. SYNTHETIC.
    const followEvents = cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.25, configVersion: 1, prefix: 'f', yes: 18, no: 42, silent: 50, at: NOW + DAY });
    const t1 = NOW + 15 * DAY;
    const follow = measure([...baseline(), ...followEvents], { now: t1, windowStart: NOW, windowEnd: t1 });
    const fc = follow.cohorts.find((c) => c.configVersion === 1);
    const check = outcomeCheck(h, fc, { start: NOW, end: t1, inputDigest: follow.inputDigest }, { honesty: true });
    expect(check).toMatchObject({ result: 'calibrated', causal: false, confidenceShown: 0.25, configVersion: 1 });
    store.append('dec-1', { kind: 'outcome_checked', at: t1, by: 'claude', check });

    const stored = store.read('dec-1')!;
    const st = reduce(stored.header, stored.events, policy);
    expect(st).toMatchObject({ status: 'implemented', decision: 'change', approvals: ['chris'], implementedConfigVersion: 1 });
    expect(st.outcomeChecks).toHaveLength(1);
    expect(stored.events.map((e) => e.kind)).toEqual(['decided', 'approved', 'implemented', 'outcome_checked']);
    // Raw observations were never touched by any of this.
    expect(baseline()).toEqual(baseline());
    expect(JSON.stringify(stored)).not.toMatch(/synthetic-\d{4}/);   // no person key reaches the decision record
  });

  it('rejection path: a rejected change cannot be implemented and takes no further events', () => {
    const store = new MemoryDecisionStore(policy);
    store.create(proposalHeader(measure(baseline(), window1)));
    store.append('dec-1', { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC' });
    store.append('dec-1', { kind: 'rejected', at: 2, by: 'chris', reason: 'SYNTHETIC: response rate too low to trust' });
    expect(() => store.append('dec-1', { kind: 'approved', at: 3, by: 'chris' })).toThrow(DecisionError);
    expect(() => store.append('dec-1', { kind: 'implemented', at: 4, by: 'chris', configVersion: 1 })).toThrow(/rejected/);
    expect(reduce(store.read('dec-1')!.header, store.read('dec-1')!.events, policy).status).toBe('rejected');
  });

  it('rollback path: rolled back to the earlier version, and the next outcome check measures that version', () => {
    const store = new MemoryDecisionStore(policy);
    const h = proposalHeader(measure(baseline(), window1));
    store.create(h);
    for (const e of [
      { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC' },
      { kind: 'approved', at: 2, by: 'chris' },
      { kind: 'implemented', at: 3, by: 'chris', configVersion: 1 },
      { kind: 'rolled_back', at: 4, by: 'chris', toConfigVersion: 0, reason: 'SYNTHETIC: a guardrail was breached' },
    ] as const) store.append('dec-1', e);
    const rec = store.read('dec-1')!;
    expect(reduce(rec.header, rec.events, policy)).toMatchObject({ status: 'rolled_back', versionToMeasure: 0, rolledBackToVersion: 0 });
    expect(dueChecks([rec], NOW + DAY)[0]).toMatchObject({ id: 'dec-1', versionToMeasure: 0 });
    // A check against the version that is no longer in force is refused.
    const stale = outcomeCheck(h, undefined, { start: 0, end: 1, inputDigest: 'x' });
    expect(() => store.append('dec-1', { kind: 'outcome_checked', at: 5, by: 'claude', check: { ...stale, configVersion: 1 } })).toThrow(/version currently in force/);
    // A check of the restored version over fresh answers: 0.95 is still not what people say, so it is honestly still miscalibrated.
    const after = measure(cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95, configVersion: 0, prefix: 'r', yes: 14, no: 46, silent: 30, at: NOW + 20 * DAY }), { now: NOW + 30 * DAY, windowStart: NOW + 16 * DAY, windowEnd: NOW + 30 * DAY });
    const check = outcomeCheck(h, after.cohorts[0], { start: 0, end: 1, inputDigest: after.inputDigest });
    expect(check.result).toBe('still_miscalibrated');
    store.append('dec-1', { kind: 'outcome_checked', at: 6, by: 'claude', check });
  });
});

describe('decision workflow: controls', () => {
  const fresh = () => { const s = new MemoryDecisionStore(policy); s.create(proposalHeader(measure(baseline(), window1))); return s; };

  it('absent review: no decision, no approval, no implementation', () => {
    const s = fresh();
    expect(() => s.append('dec-1', { kind: 'approved', at: 1, by: 'chris' })).toThrow(/only a decision to change awaits approval/);
    expect(() => s.append('dec-1', { kind: 'implemented', at: 1, by: 'chris', configVersion: 1 })).toThrow(DecisionError);
  });
  it('unauthorised review: a non-approver cannot approve, and an agent cannot approve its own work', () => {
    const s = fresh();
    s.append('dec-1', { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC' });
    expect(() => s.append('dec-1', { kind: 'approved', at: 2, by: 'claude' })).toThrow(/not an approver/);
    expect(() => s.append('dec-1', { kind: 'approved', at: 2, by: 'second-approver-synthetic' })).toThrow(/not an approver/);   // second approver is only for the threshold
    expect(reduce(s.read('dec-1')!.header, s.read('dec-1')!.events, policy).missingApprovals).toEqual(['primary approver (chris)']);
  });
  it('one approval per person', () => {
    const s = fresh();
    s.append('dec-1', { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC' });
    s.append('dec-1', { kind: 'approved', at: 2, by: 'chris' });
    expect(() => s.append('dec-1', { kind: 'approved', at: 3, by: 'CHRIS ' })).toThrow(/one approval per person/);
  });
  it('80% dispute threshold: Chris alone is not enough, a different second approver is required, and with none named it fails closed', () => {
    const disputes = cohortEvents({ hexagonId: 'cookies-status', tileKind: 'needs_fixing', confidence: 0.95, configVersion: 0, prefix: 'd', disputed: 30, kept: 30, silent: 20, at: T0 + DAY });
    const report = measure(disputes, window1);
    const h = proposalHeader(report, { id: 'dec-80', targetKind: 'dispute_threshold' });
    const s = new MemoryDecisionStore(policy);
    s.create(h);
    s.append('dec-80', { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC' });
    s.append('dec-80', { kind: 'approved', at: 2, by: 'chris' });
    expect(() => s.append('dec-80', { kind: 'implemented', at: 3, by: 'chris', configVersion: 1 })).toThrow(/second approver/);
    expect(() => s.append('dec-80', { kind: 'approved', at: 3, by: 'claude' })).toThrow(/not an approver/);
    s.append('dec-80', { kind: 'approved', at: 3, by: 'second-approver-synthetic' });
    s.append('dec-80', { kind: 'implemented', at: 4, by: 'chris', configVersion: 1 });

    const noSecond = new MemoryDecisionStore({ ...policy, secondApprovers: [] });
    noSecond.create(h);
    noSecond.append('dec-80', { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC' });
    noSecond.append('dec-80', { kind: 'approved', at: 2, by: 'chris' });
    expect(() => noSecond.append('dec-80', { kind: 'implemented', at: 3, by: 'chris', configVersion: 1 })).toThrow(DecisionError);
  });
  it('a header is written once; a decision once; a reason is required', () => {
    const s = fresh();
    expect(() => s.create(s.read('dec-1')!.header)).toThrow(/written once/);
    expect(() => s.append('dec-1', { kind: 'decided', at: 1, by: 'chris', decision: 'keep', reason: '  ' })).toThrow(/reason/);
    s.append('dec-1', { kind: 'decided', at: 1, by: 'chris', decision: 'keep', reason: 'SYNTHETIC' });
    expect(() => s.append('dec-1', { kind: 'decided', at: 2, by: 'chris', decision: 'change', reason: 'again' })).toThrow(/once/);
    expect(reduce(s.read('dec-1')!.header, s.read('dec-1')!.events, policy).status).toBe('decided_no_change');
  });
  it('no automatic promotion: a keep, stop or insufficient-evidence decision can never be implemented', () => {
    for (const d of ['keep', 'stop', 'insufficient_evidence'] as const) {
      const s = fresh();
      s.append('dec-1', { kind: 'decided', at: 1, by: 'chris', decision: d, reason: 'SYNTHETIC' });
      expect(() => s.append('dec-1', { kind: 'implemented', at: 2, by: 'chris', configVersion: 1 })).toThrow(DecisionError);
    }
  });
  it('a decision needs an owner, a hypothesis, a guardrail and a future outcome-check date; a change must stay inside its bounds', () => {
    const report = measure(baseline(), window1);
    const c = report.cohorts[0];
    const base = { id: 'x', now: NOW, owner: 'chris', hypothesis: 'h', windowStart: T0, windowEnd: NOW, inputDigest: report.inputDigest, rulesVersion: report.rulesVersion, guardrails: guard, nextOutcomeCheckDue: NOW + DAY };
    expect(() => headerFromCohort(c, { ...base, owner: ' ' })).toThrow(/owner/);
    expect(() => headerFromCohort(c, { ...base, hypothesis: '' })).toThrow(/hypothesis/);
    expect(() => headerFromCohort(c, { ...base, guardrails: [] })).toThrow(/guardrail/);
    expect(() => headerFromCohort(c, { ...base, nextOutcomeCheckDue: NOW })).toThrow(/future/);
    const s = new MemoryDecisionStore(policy);
    s.create(headerFromCohort(c, { ...base, bounds: { min: 0.5, max: 0.95 }, policy }));   // proposed 0.25 is outside 0.5-0.95
    expect(() => s.append('x', { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'r' })).toThrow(/bounds/);
  });
  it('insufficient evidence is a valid recorded decision for a report-only cohort, not an error', () => {
    const sparse = measure(cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95, configVersion: 0, prefix: 's', yes: 2, no: 9, silent: 5, at: T0 + DAY }), window1);
    const h = headerFromCohort(sparse.cohorts[0], { id: 'dec-s', now: NOW, owner: 'chris', hypothesis: 'SYNTHETIC', windowStart: T0, windowEnd: NOW, inputDigest: sparse.inputDigest, rulesVersion: sparse.rulesVersion, guardrails: guard, nextOutcomeCheckDue: NOW + DAY, policy });
    const s = new MemoryDecisionStore(policy);
    s.create(h);
    s.append('dec-s', { kind: 'decided', at: 1, by: 'chris', decision: 'insufficient_evidence', reason: 'SYNTHETIC: 11 of 30 responders' });
    expect(() => s.append('dec-s', { kind: 'decided', at: 2, by: 'chris', decision: 'change', reason: 'x' })).toThrow();
    expect(h.evidence.note).toMatch(/Report-only/);
  });
});

describe('outcome check honesty', () => {
  const h = () => proposalHeader(measure(baseline(), window1));
  it('sparse follow-up is insufficient evidence; missing follow-up is unknown, not improvement', () => {
    const sparse = measure(cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.25, configVersion: 1, prefix: 'f', yes: 3, no: 7, silent: 5, at: NOW }), { now: NOW + DAY, windowStart: NOW - 1, windowEnd: NOW + DAY });
    expect(outcomeCheck(h(), sparse.cohorts[0], { start: 0, end: 1, inputDigest: 'x' }).result).toBe('insufficient_evidence');
    const none = outcomeCheck(h(), undefined, { start: 0, end: 1, inputDigest: 'x' });
    expect(none.result).toBe('insufficient_evidence');
    expect(none.note).toMatch(/unknown/);
  });
  it('a guardrail that was not measured is reported as unknown, never as held, and the check is never causal', () => {
    const c = outcomeCheck(h(), undefined, { start: 0, end: 1, inputDigest: 'x' });
    expect(c.guardrails).toEqual([{ name: 'honesty', held: null }]);
    expect(c.causal).toBe(false);
  });
  it('a confidence shown that the follow-up answers do not support is reported as still miscalibrated', () => {
    const follow = measure(cohortEvents({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.6, configVersion: 1, prefix: 'f', yes: 15, no: 45, silent: 10, at: NOW }), { now: NOW + DAY, windowStart: NOW - 1, windowEnd: NOW + DAY });
    expect(outcomeCheck(h(), follow.cohorts[0], { start: 0, end: 1, inputDigest: 'x' }).result).toBe('still_miscalibrated');
  });
});

describe('read-only review', () => {
  const events: LedgerEvent[] = baseline();
  it('prints warnings first, includes denominators, response rate, versions, decisions and a due check, and says scheduling is pending', () => {
    const store = new MemoryDecisionStore(policy);
    const report = measure(events, window1);
    store.create(proposalHeader(report));
    store.append('dec-1', { kind: 'decided', at: 1, by: 'chris', decision: 'change', reason: 'SYNTHETIC' });
    store.append('dec-1', { kind: 'approved', at: 2, by: 'chris' });
    store.append('dec-1', { kind: 'implemented', at: 3, by: 'chris', configVersion: 1 });
    const text = renderReview(report, store.all());
    expect(text).toMatch(/## Read first[\s\S]*## Tiles/);
    expect(text).toMatch(/\| location\/web-scan \| our_guess \| v0 \| 0\.95 \| 100 \| 60 \| 60% \| 15\/45 \|/);
    expect(text).toMatch(/implemented as config version 1/);
    expect(text).toMatch(/outcome check due for dec-1/);
    expect(text).toMatch(/Scheduling: PENDING/);
    expect(text).toMatch(/SYNTHETIC FIXTURE/);
    expect(text).not.toMatch(/synthetic-\d{4}/);
  });
  it('a stale or empty report says so at the top', () => {
    expect(renderReview(measure([], window1))).toMatch(/STALE or empty/);
  });
  it('is read-only: rendering changes neither the report nor the store', () => {
    const store = new MemoryDecisionStore(policy);
    const report = measure(events, window1);
    store.create(proposalHeader(report));
    const before = JSON.stringify([report, store.all()]);
    renderReview(report, store.all());
    expect(JSON.stringify([report, store.all()])).toBe(before);
  });
});
