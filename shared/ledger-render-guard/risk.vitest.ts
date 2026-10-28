// @vitest-environment node
/**
 * MPC-8753 — the risk axis as properties that must hold for ANY input (design MPC-7898 A3 + A3.9).
 * The SQL twin (ledger._risk_eval / render_progress_risk) is exercised by supabase/tests/mpc-8753-risk-axis.test.sql.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canAccept, riskProgress, riskState, type RiskClaim } from './risk.ts';

const RUNS = { numRuns: 1000 };
const hash = fc.constantFrom('h1', 'h2');
const scan = fc.constantFrom('scan-1', 'scan-2');
const claim: fc.Arbitrary<RiskClaim> = fc.record({
  riskApplicable: fc.boolean(),
  status: fc.constantFrom('found', 'clear', 'not_checked', 'check_failed', null),
  expired: fc.boolean(),
  notMe: fc.boolean(),
  valueHash: hash,
  scanKey: scan,
  consequenceVersion: fc.constantFrom<number | null>(1, 2, null),
  educations: fc.array(fc.record({ valueHash: hash, scanKey: scan, consequenceVersion: fc.constantFrom<number | null>(1, 2, null), shownAt: fc.integer({ min: 0, max: 100 }) }), { maxLength: 3 }),
  decisions: fc.array(fc.record({ kind: fc.constantFrom('accepted', 'removed'), valueHash: hash, scanKey: scan, decidedAt: fc.integer({ min: 0, max: 100 }) }), { maxLength: 3 }),
}) as fc.Arbitrary<RiskClaim>;

const base: RiskClaim = { riskApplicable: true, status: 'found', expired: false, notMe: false, valueHash: 'h1', scanKey: 'scan-1', consequenceVersion: 1, educations: [], decisions: [] };

describe('risk state (A3.2, A3.9)', () => {
  it('a found claim with no events is unknown; educated after a matching education; accepted after a matching decision', () => {
    expect(riskState(base).state).toBe('unknown');
    const edu = { valueHash: 'h1', scanKey: 'scan-1', consequenceVersion: 1, shownAt: 1 };
    expect(riskState({ ...base, educations: [edu] }).state).toBe('educated');
    expect(riskState({ ...base, educations: [edu], decisions: [{ kind: 'accepted', valueHash: 'h1', scanKey: 'scan-1', decidedAt: 2 }] }).state).toBe('accepted');
  });
  it('D7: nothing carries over to another scan, a changed value or a changed consequence text', () => {
    const edu = { valueHash: 'h1', scanKey: 'scan-1', consequenceVersion: 1, shownAt: 1 };
    const acc = { kind: 'accepted' as const, valueHash: 'h1', scanKey: 'scan-1', decidedAt: 2 };
    expect(riskState({ ...base, scanKey: 'scan-2', educations: [edu], decisions: [acc] }).state).toBe('unknown');
    expect(riskState({ ...base, valueHash: 'h2', educations: [edu], decisions: [acc] }).state).toBe('unknown');
    expect(riskState({ ...base, consequenceVersion: 2, educations: [edu] }).state).toBe('unknown');
  });
  it('unchecked, failed, stale, clear, no-axis and not_me are never unaddressed risk', () => {
    for (const status of ['not_checked', 'check_failed', null] as const) expect(riskState({ ...base, status }).state).toBe('not_applicable');
    expect(riskState({ ...base, expired: true }).state).toBe('not_applicable');
    expect(riskState({ ...base, status: 'clear' })).toEqual({ state: 'not_applicable', reason: 'clear' });
    expect(riskState({ ...base, riskApplicable: false })).toEqual({ state: 'not_applicable', reason: 'no_risk_axis' });
    expect(riskState({ ...base, notMe: true }).state).toBe('not_me');
  });
  it('H12: acceptance is legal only from educated', () => {
    fc.assert(fc.property(claim, (c) => canAccept(c) === (riskState(c).state === 'educated')), RUNS);
    expect(canAccept(base)).toBe(false);
  });
});

describe('risk progress (A3.4)', () => {
  it('the risk buckets partition any profile, and the score is exactly unknown + educated', () => {
    fc.assert(fc.property(fc.array(claim, { maxLength: 30 }), (items) => {
      const p = riskProgress(items);
      expect(p.unaddressedRisk + p.accepted + p.removed + p.clear + p.notMe + p.notChecked + p.riskNotApplicable).toBe(items.length);
      expect(p.unaddressedRisk).toBe(p.unaddressedUnknown + p.unaddressedEducated);
      for (const v of Object.values(p)) expect(Number.isInteger(v)).toBe(true);   // G6: whole numbers only
    }), RUNS);
  });
  it('an item that is not found can never raise the score', () => {
    fc.assert(fc.property(fc.array(claim, { maxLength: 20 }), (items) => {
      const notFound = items.map((c) => ({ ...c, status: (c.status === 'found' ? 'clear' : c.status) as RiskClaim['status'] }));
      expect(riskProgress(notFound).unaddressedRisk).toBe(0);
    }), RUNS);
  });
  it('accepting an educated claim lowers the score by exactly one', () => {
    const edu = { valueHash: 'h1', scanKey: 'scan-1', consequenceVersion: 1, shownAt: 1 };
    const before = riskProgress([{ ...base, educations: [edu] }, base]);
    const after = riskProgress([{ ...base, educations: [edu], decisions: [{ kind: 'accepted', valueHash: 'h1', scanKey: 'scan-1', decidedAt: 2 }] }, base]);
    expect(before.unaddressedRisk - after.unaddressedRisk).toBe(1);
    expect(after.accepted).toBe(1);
  });
  it('fails closed: a malformed item is "not checked", never accepted; a null profile is empty', () => {
    expect(riskProgress([null as unknown as RiskClaim]).notChecked).toBe(1);
    expect(riskProgress(null).unaddressedRisk).toBe(0);
  });
  it('the return type has no fractional field', () => {
    expect(Object.keys(riskProgress([base])).sort()).toEqual(['accepted', 'clear', 'notChecked', 'notMe', 'removed', 'riskNotApplicable', 'unaddressedEducated', 'unaddressedRisk', 'unaddressedUnknown']);
  });
});
