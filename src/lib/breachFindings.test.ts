import { describe, it, expect } from 'vitest';
import { breachFindingsFromLookup } from './breachFindings';
import { scoredHexagons } from './identityConfirmation';

const base = { status: 'checked' as const, pastes: [], pasteCount: 0 };
const hibp = { ...base, confidence: 'high' as const, breaches: [{ name: 'Adobe', date: '2013-10-04', dataClasses: ['Email addresses', 'Passwords'] }] };
const xon = { ...base, confidence: 'medium' as const, breaches: [{ name: 'Canva', date: '', dataClasses: [] }, { name: 'Canva', date: '', dataClasses: [] }] };

describe('breachFindingsFromLookup', () => {
  it('high confidence (HIBP) -> checked 0.95 with detail and password advice', () => {
    const [h] = breachFindingsFromLookup(hibp, 'hibp');
    expect(h).toMatchObject({ id: 'breach-adobe', pillar: 'email', status: 'checked', confidence_score: 0.95, source: 'hibp' });
    expect(h.data).toBe('Adobe (2013): Email addresses, Passwords');
    expect(h.remediation).toMatch(/password/i);
  });
  it('medium confidence (XposedOrNot) -> guess 0.6, with unique ids for repeated names', () => {
    const hs = breachFindingsFromLookup(xon, 'xposedornot');
    expect(hs.map((h) => [h.id, h.status, h.confidence_score])).toEqual([['breach-canva', 'guess', 0.6], ['breach-canva-2', 'guess', 0.6]]);
  });
  it('low confidence -> guess 0.4', () => {
    expect(breachFindingsFromLookup({ ...xon, confidence: 'low' }, null)[0].confidence_score).toBe(0.4);
  });
  it('adds one paste finding', () => {
    const hs = breachFindingsFromLookup({ ...hibp, pasteCount: 2, pastes: [] }, 'hibp');
    expect(hs.at(-1)).toMatchObject({ id: 'email-pastes', data: '2 public pastes listing this email' });
  });
  it('not_checked lookup -> one not_checked finding, never scored, never "clear"', () => {
    const hs = breachFindingsFromLookup({ ...base, status: 'not_checked', confidence: 'low', breaches: [] });
    expect(hs).toHaveLength(1);
    expect(hs[0].status).toBe('not_checked');
    expect(scoredHexagons({ hexagons: hs })).toHaveLength(0);
  });
  it('checked with nothing found -> no findings', () => {
    expect(breachFindingsFromLookup({ ...base, confidence: 'high', breaches: [] })).toEqual([]);
  });
  it('unanswered guesses are not scored until confirmed', () => {
    expect(scoredHexagons({ hexagons: breachFindingsFromLookup(xon, 'xposedornot') })).toHaveLength(0);
  });
});
