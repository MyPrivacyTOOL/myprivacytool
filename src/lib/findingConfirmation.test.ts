import { describe, it, expect } from 'vitest';
import {
  IdentityFinding, confirmFinding, disputeFinding, canDispute, countsTowardRisk, riskFindings, learningEvent,
} from './findingConfirmation';

const f = (over: Partial<IdentityFinding>): IdentityFinding => ({
  id: 'x', pillar: 'email', label: 'Email', status: 'guess', data: 'a@b.c', source: 'provider-a',
  confidence_score: 0.6, remediation: null, ...over,
});

describe('identity confirmation transitions', () => {
  it('guess + yes -> confirmed', () => {
    const r = confirmFinding(f({}), true);
    expect(r.status).toBe('confirmed');
    expect(r.interaction_state).toBe('confirmed_by_user');
  });
  it('guess + no -> false_positive', () => {
    const r = confirmFinding(f({}), false);
    expect(r.status).toBe('false_positive');
    expect(r.interaction_state).toBe('rejected_by_user');
  });
  it('confirm is refused on anything but a guess', () => {
    for (const status of ['checked', 'given', 'not_checked', 'confirmed', 'false_positive', 'disputed'] as const) {
      const x = f({ status });
      expect(confirmFinding(x, true)).toBe(x);
    }
  });
  it('dispute only on checked above 0.8', () => {
    expect(disputeFinding(f({ status: 'checked', confidence_score: 0.95 })).status).toBe('disputed');
    expect(canDispute(f({ status: 'checked', confidence_score: 0.8 }))).toBe(false);
    expect(canDispute(f({ status: 'checked' }))).toBe(false);
    expect(canDispute(f({ status: 'guess', confidence_score: 0.95 }))).toBe(false);
    const x = f({ status: 'given', confidence_score: 0.99 });
    expect(disputeFinding(x)).toBe(x);
  });
  it('a false_positive can never come back', () => {
    const fp = confirmFinding(f({}), false);
    expect(confirmFinding(fp, true)).toBe(fp);
  });
});

describe('risk score inclusion', () => {
  it('excludes false_positive, disputed, unconfirmed guess and not_checked', () => {
    const list = [
      f({ id: 'a', status: 'checked' }), f({ id: 'b', status: 'given' }), f({ id: 'c', status: 'confirmed' }),
      f({ id: 'd', status: 'guess' }), f({ id: 'e', status: 'false_positive' }),
      f({ id: 'g', status: 'disputed' }), f({ id: 'h', status: 'not_checked' }),
    ];
    expect(riskFindings(list).map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(countsTowardRisk(confirmFinding(f({}), false))).toBe(false);
    expect(countsTowardRisk(confirmFinding(f({}), true))).toBe(true);
  });
});

describe('learning event', () => {
  it('carries provider and decision but never the found value', () => {
    const before = f({ status: 'checked', confidence_score: 0.95 });
    const e = learningEvent(before, disputeFinding(before))!;
    expect(e).toEqual({ id: 'x', pillar: 'email', source: 'provider-a', statusBefore: 'checked', confidence_score: 0.95, decision: 'disputed' });
    expect(JSON.stringify(e)).not.toContain('a@b.c');
  });
  it('is null when the transition was refused', () => {
    const x = f({ status: 'given' });
    expect(learningEvent(x, disputeFinding(x))).toBeNull();
  });
});
