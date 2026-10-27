import { describe, it, expect } from 'vitest';
import { recheckJourneyEnabled } from './recheckJourney';

describe('recheckJourneyEnabled', () => {
  it('is off unless the build sets it, and a URL parameter never turns it on', () => {
    expect(recheckJourneyEnabled(undefined)).toBe(false);
    expect(recheckJourneyEnabled('false')).toBe(false);
    expect(recheckJourneyEnabled('true')).toBe(true);
    expect(recheckJourneyEnabled('1')).toBe(true);
    window.history.pushState({}, '', '/?hex_v2=2&recheck_journey=1');
    expect(recheckJourneyEnabled(undefined)).toBe(false);
  });
});
