import { describe, it, expect } from 'vitest';
import { toTile, tileKind, TILE_COPY, riskProfile, riskProfileParts, tileAriaLabel, type TileKind } from './hexagonTile';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { captureStatus } from '../../shared/hexagon-registry/status.js';

// MPC-7916 Phase 1: one function decides what a tile says. These are the rows Chris agreed on MPC-7913.
describe('toTile (MPC-7916)', () => {
  const rows: [string, string, string, TileKind][] = [
    ['webrtc-leak says No Leak Detected: the code cannot tell this from a blocked check', 'webrtc-leak', 'No Leak Detected', 'couldnt_check'],
    ['webrtc-leak that is leaking needs fixing', 'webrtc-leak', 'Leaking: 203.0.113.9', 'needs_fixing'],
    ['canvas fingerprint (medium risk) needs fixing', 'canvas-fingerprint', 'Vale Tulip', 'needs_fixing'],
    ['dns-leak cannot be checked from a web page, whatever the detector said', 'dns-leak', 'No Leak Detected', 'cant_check_here'],
    ['dns-leak that claims a leak still cannot be checked from a web page', 'dns-leak', 'Leaking: 10.0.0.1', 'cant_check_here'],
    ['typing patterns with no input is not checked yet', 'typing-patterns', 'No input yet', 'not_checked'],
    ['location is an estimate, so it is our guess', 'location', 'Springfield, England', 'our_guess'],
    ['internet provider is an estimate, so it is our guess', 'isp', 'Example Broadband', 'our_guess'],
    ['a placeholder location is not a guess, we could not tell', 'location', 'Location Detected', 'couldnt_check'],
    ['primary language is measured and low risk', 'primary-language', 'English (UK)', 'seen_low_risk'],
    ['cookies that are empty are the registry-allowed clear', 'cookies-status', 'Empty', 'clear'],
    ['a failed read is could not check', 'battery', 'Check failed', 'couldnt_check'],
    ['the TLS version is never measured, so it is not a guess or a fact', 'tls-config', 'TLS 1.3 (likely)', 'couldnt_check'],
    ['an id that is not in the registry never claims anything', 'not-a-hexagon', 'anything', 'not_checked'],
  ];
  it.each(rows)('%s', (_name, id, value, kind) => {
    expect(tileKind({ id, value })).toBe(kind);
  });

  it('copy: green is solid and only for clear; purple is faint and only for a guess; grey shows no value when no claim is made', () => {
    for (const [kind, c] of Object.entries(TILE_COPY)) {
      if (c.colour === 'green') expect(kind).toBe('clear');
      if (c.colour === 'purple') {
        expect(kind).toBe('our_guess');
        expect(c.level).toBe('faint');
      }
      if (c.colour === 'red') expect(c.level).toBe('solid');
    }
    for (const k of ['not_checked', 'couldnt_check', 'cant_check_here'] as TileKind[]) {
      expect(TILE_COPY[k].colour).toBe('grey');
      expect(TILE_COPY[k].showValue).toBe(false);
    }
  });

  it('no tile line, glyph or aria label ever contains a percentage', () => {
    for (const c of Object.values(TILE_COPY)) {
      expect(c.line).not.toMatch(/%/);
      expect(c.glyph).not.toMatch(/%/);
    }
    const t = toTile({ id: 'location', value: 'Springfield' });
    expect(tileAriaLabel('Location', 'Springfield', t)).not.toMatch(/%|confidence/i);
  });

  it('honesty: for every registry hexagon, a placeholder or failed value never becomes clear or needs fixing', () => {
    for (const h of HEXAGONS as { id: string }[]) {
      for (const value of ['No input yet', 'Check failed', 'Unknown', 'Collecting...', '']) {
        const k = tileKind({ id: h.id, value });
        expect(['not_checked', 'couldnt_check', 'cant_check_here']).toContain(k);
      }
    }
  });

  it('honesty: clear only where captureStatus says clear, and the 7 cannot-be-checked tiles are always grey', () => {
    for (const h of HEXAGONS as { id: string; truth: { level: string } }[]) {
      for (const value of ['Empty', 'None', 'Secure (HTTPS)', 'No Leak Detected', 'Something real']) {
        const k = tileKind({ id: h.id, value });
        if (k === 'clear') expect(captureStatus(h.id, value, {})).toBe('clear');
        if (h.truth.level === 'cannot_be_checked') expect(k).toBe('cant_check_here');
      }
    }
  });

  it('the context is passed on: an assumed WiFi default is not checked', () => {
    expect(tileKind({ id: 'connection', value: 'WiFi' }, { connectionIsMeasured: false })).not.toBe('our_guess');
  });
});

describe('risk profile (MPC-7916)', () => {
  it('counts the tiles in each group; unchecked kinds all count as not checked', () => {
    const p = riskProfile([
      { kind: 'clear' }, { kind: 'needs_fixing' }, { kind: 'needs_fixing' }, { kind: 'our_guess' },
      { kind: 'seen_low_risk' }, { kind: 'not_checked' }, { kind: 'couldnt_check' }, { kind: 'cant_check_here' },
    ]);
    expect(p).toEqual({ clear: 1, needsFixing: 2, ourGuess: 1, seenLowRisk: 1, notChecked: 3 });
  });

  it('is plain counts: no percentage, no "of", no rating word', () => {
    const text = riskProfileParts(riskProfile([{ kind: 'needs_fixing' }, { kind: 'not_checked' }])).map((p) => p.text).join(' · ');
    expect(text).toBe('0 clear · 1 needs fixing · 0 our guess · 0 seen, low risk · 1 not checked yet');
    expect(text).not.toMatch(/%| of |low risk rating|medium|high/i);
  });

  it('an empty scan is all zeros, never "clear"', () => {
    expect(riskProfile([])).toEqual({ clear: 0, needsFixing: 0, ourGuess: 0, seenLowRisk: 0, notChecked: 0 });
  });
});
