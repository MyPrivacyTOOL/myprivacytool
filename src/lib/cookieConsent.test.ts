import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasConsent } from './cookieConsent';

// The gate for every non-essential script and for the MPC-7915 learning events: it must fail closed.
const withCmp = (impl: unknown) => { (window as unknown as { __cmp?: unknown }).__cmp = impl; };
afterEach(() => { delete (window as unknown as { __cmp?: unknown }).__cmp; });

describe('hasConsent', () => {
  it('is false when the consent manager is missing or still loading', () => {
    expect(hasConsent()).toBe(false);
    withCmp(vi.fn(() => undefined));
    expect(hasConsent()).toBe(false);
  });
  it('is false when the visitor has made no choice yet, even if purposes look granted', () => {
    withCmp(() => ({ userChoiceExists: false, purposeConsents: { c1: true } }));
    expect(hasConsent()).toBe(false);
  });
  it('is false when every purpose was refused or none are listed', () => {
    withCmp(() => ({ userChoiceExists: true, purposeConsents: { c1: false, c2: false } }));
    expect(hasConsent()).toBe(false);
    withCmp(() => ({ userChoiceExists: true, purposeConsents: {} }));
    expect(hasConsent()).toBe(false);
    withCmp(() => ({ userChoiceExists: true }));
    expect(hasConsent()).toBe(false);
  });
  it('is false when the consent manager throws', () => {
    withCmp(() => { throw new Error('boom'); });
    expect(hasConsent()).toBe(false);
  });
  it('is true only after a choice with at least one purpose granted (the same test index.html uses for Google Analytics)', () => {
    withCmp(() => ({ userChoiceExists: true, purposeConsents: { c1: false, c2: true } }));
    expect(hasConsent()).toBe(true);
  });
});
