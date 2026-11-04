import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_KEY, getChoice, hasConsent, onConsentChange, openCookiePreferences, onOpenPreferences, setChoice } from './cookieConsent';

// The gate for every non-essential script and for the MPC-7915 learning events: it must fail closed.
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('hasConsent', () => {
  it('is false before any choice', () => {
    expect(getChoice()).toBeNull();
    expect(hasConsent()).toBe(false);
  });
  it('is false for "Essential only" and true only for "Accept analytics"', () => {
    setChoice(false);
    expect(hasConsent()).toBe(false);
    expect(getChoice()?.analytics).toBe(false);
    setChoice(true);
    expect(hasConsent()).toBe(true);
    expect(getChoice()?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('is false for damaged or foreign values', () => {
    for (const bad of ['not json', 'null', '{"v":2,"analytics":true,"at":"x"}', '{"v":1,"analytics":"yes","at":"x"}', '{"v":1,"analytics":true}']) {
      localStorage.setItem(CONSENT_KEY, bad);
      expect(hasConsent()).toBe(false);
    }
  });
  it('is false when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(hasConsent()).toBe(false);
  });
});

describe('events', () => {
  it('onConsentChange fires when a choice is saved, and stops after unsubscribe', () => {
    const cb = vi.fn();
    const off = onConsentChange(cb);
    setChoice(true);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setChoice(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('a blocked write still notifies and never throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const cb = vi.fn();
    onConsentChange(cb);
    expect(() => setChoice(true)).not.toThrow();
    expect(cb).toHaveBeenCalled();
    expect(hasConsent()).toBe(false);
  });
  it('openCookiePreferences reaches the banner', () => {
    const cb = vi.fn();
    const off = onOpenPreferences(cb);
    openCookiePreferences();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
});
