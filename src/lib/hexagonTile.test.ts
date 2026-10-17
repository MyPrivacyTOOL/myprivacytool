import { describe, it, expect } from 'vitest';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { toTile, summarize, cannotCheckLast, bandFor, GUESS_BELOW } from './hexagonTile';

const cannotIds = HEXAGONS.filter((h) => h.truth.level === 'cannot_be_checked').map((h) => h.id);

describe('toTile', () => {
  it('a measured value at 80+ is verified, below 80 is inferred (80 is not a guess)', () => {
    expect(toTile({ id: 'device', value: 'Desktop (Windows 11)', confidence: 92 }).class).toBe('verified');
    expect(toTile({ id: 'device', value: 'Desktop (Windows 11)', confidence: GUESS_BELOW }).class).toBe('verified');
    const t = toTile({ id: 'device', value: 'Desktop (Windows 11)', confidence: 79 });
    expect(t.class).toBe('inferred');
    expect(t.action_key).toBe('confirm');
  });

  it('the 7 registry cannot-be-checked tiles are always unknown, whatever value or confidence they carry', () => {
    expect(cannotIds).toHaveLength(7);
    for (const id of cannotIds) {
      const t = toTile({ id, value: 'Google: signed in', confidence: 100 });
      expect(t.class).toBe('unknown');
      expect(t.unknown_reason).toBe('cannot_check_from_web');
      expect(t.bar).toBeNull();
      expect(t.result).toBeUndefined();
    }
  });

  it('a stored confidence on a not-checked value never makes a verified or inferred tile', () => {
    for (const value of ['Check failed', 'Unknown', 'Checking...', 'No input yet', 'blocked']) {
      const t = toTile({ id: 'typing-patterns', value, confidence: 100 });
      expect(t.class).toBe('unknown');
      expect(t.bar).toBeNull();
    }
    expect(toTile({ id: 'typing-patterns', value: 'No input yet', confidence: 100 }).unknown_reason).toBe('not_yet_checked');
    expect(toTile({ id: 'cookies-status', value: 'Check failed', confidence: 100 }).unknown_reason).toBe('check_unavailable');
  });

  it('"nothing seen" values the code cannot tell from a failed check stay unknown, not clean', () => {
    expect(toTile({ id: 'webrtc-leak', value: 'No Leak Detected', confidence: 90 }).class).toBe('unknown');
    expect(toTile({ id: 'extension-detection', value: 'None detected', confidence: 90 }).class).toBe('unknown');
  });

  it('a clear result is verified only where the registry allows it', () => {
    const t = toTile({ id: 'cookies-status', value: 'Empty', confidence: 90 });
    expect(t.class).toBe('verified');
    expect(t.result).toBe('clear');
  });

  it('estimates keep the estimate flag; an unassumed id is unknown', () => {
    expect(toTile({ id: 'location', value: 'Springfield, Exampleshire', confidence: 95 }).is_estimate).toBe(true);
    expect(toTile({ id: 'device', value: 'Desktop', confidence: 92 }).is_estimate).toBe(false);
    expect(toTile({ id: 'revealing', value: 'Data Point Revealed', confidence: 0 }).class).toBe('unknown');
  });

  it('self_attested is never produced from scan data', () => {
    for (const h of HEXAGONS) expect(toTile({ id: h.id, value: 'x', confidence: 99 }).class).not.toBe('self_attested');
  });
});

describe('summarize', () => {
  it('returns exactly three integers; inferred and unknown both count as not yet checked', () => {
    const tiles = [
      toTile({ id: 'device', value: 'Desktop', confidence: 92 }),
      toTile({ id: 'device', value: 'Desktop', confidence: 50 }),
      toTile({ id: 'dns-leak', value: 'Leak', confidence: 100 }),
    ];
    const s = summarize(tiles);
    expect(Object.keys(s).sort()).toEqual(['board', 'not_yet_checked', 'self_attested_fixes', 'verified']);
    expect(s).toMatchObject({ verified: 1, self_attested_fixes: 0, not_yet_checked: 2 });
  });
});

describe('cannotCheckLast', () => {
  it('moves cannot-check ids to the end, keeping the rest in order', () => {
    const ids = ['dns-leak', 'canvas-fingerprint', 'social-platforms', 'device', 'webrtc-leak'].map((id) => ({ id }));
    expect(cannotCheckLast(ids).map((i) => i.id)).toEqual(['canvas-fingerprint', 'device', 'webrtc-leak', 'dns-leak', 'social-platforms']);
  });
});

describe('bandFor', () => {
  it('maps confidence to word and bar', () => {
    expect(bandFor(97)).toMatchObject({ word: 'sure', bar: 5 });
    expect(bandFor(80)).toMatchObject({ word: 'pretty sure', bar: 4 });
    expect(bandFor(79)).toMatchObject({ word: 'probably', bar: 3 });
    expect(bandFor(10)).toMatchObject({ word: 'just a guess', bar: 1 });
  });
});
