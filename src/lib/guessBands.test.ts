import { describe, it, expect } from 'vitest';
import { BAND_FILL_OPACITY, BAND_WORD, GUESS_BAND_IDS, guessBandFor } from './guessBands';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';

describe('guess bands (approved by Chris, 2026-10-20)', () => {
  it('every estimated hexagon in the registry has a band, so a new estimate cannot ship without one', () => {
    const estimated = HEXAGONS.filter((h) => h.truth.level === 'estimated').map((h) => h.id).sort();
    expect([...GUESS_BAND_IDS].sort()).toEqual(estimated);
    for (const id of estimated) expect(guessBandFor(id)).not.toBeNull();
  });
  it('matches the approved table', () => {
    for (const id of ['location', 'isp', 'language-mismatch', 'user-profile', 'extension-detection', 'fingerprint-protection', 'browser-security']) expect(guessBandFor(id)).toBe('maybe');
    expect(guessBandFor('demographic')).toBe('weak');
    expect(guessBandFor('tls-config')).toBe('weak');
  });
  it('Connection Type is likely only when the browser reported it, otherwise maybe', () => {
    expect(guessBandFor('connection', { connectionIsMeasured: true })).toBe('likely');
    expect(guessBandFor('connection', { connectionIsMeasured: false })).toBe('maybe');
    expect(guessBandFor('connection')).toBe('maybe');
  });
  it('a hexagon that is not in the table has no band', () => {
    expect(guessBandFor('cookies-status')).toBeNull();
  });
  it('darker means surer, and the words never contain a number', () => {
    expect(BAND_FILL_OPACITY.likely).toBeGreaterThan(BAND_FILL_OPACITY.maybe);
    expect(BAND_FILL_OPACITY.maybe).toBeGreaterThan(BAND_FILL_OPACITY.weak);
    expect(BAND_FILL_OPACITY.maybe).toBe(0.16);   // "maybe" is the faint purple used before bands existed
    for (const w of Object.values(BAND_WORD)) expect(w).not.toMatch(/\d|%/);
  });
});
