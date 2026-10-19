import { describe, it, expect } from 'vitest';
import {
  buildTeaser, TOP_SIX_EXPLAINERS, TOP_SIX_IDS, ALICE_QUIET_IDS, ALICE_INTRO, ALICE_WEBRTC_LEAK, aliceQuietLine,
} from './exposureCopy';

describe('exposureCopy', () => {
  it('has one explainer per top-six id and none with alarm words or percentages', () => {
    for (const id of TOP_SIX_IDS) {
      const s = TOP_SIX_EXPLAINERS[id];
      expect(s).toBeTruthy();
      expect(s).not.toMatch(/%|\bscary|danger|warning|extremely|unique to you/i);
    }
  });
  it('names up to three found top-six items and the real remaining count', () => {
    const ids = ['device', 'webrtc-leak', 'canvas-fingerprint', 'dns-leak', 'audio-fingerprint', 'browser'];
    const t = buildTeaser(ids, { 'webrtc-leak': 'WebRTC leak status', 'canvas-fingerprint': 'canvas fingerprint', 'dns-leak': 'DNS leak status' });
    expect(t).toBe('We found your WebRTC leak status, canvas fingerprint and DNS leak status, plus 3 more things.');
  });
  it('skips top-six items the browser did not produce', () => {
    expect(buildTeaser(['device', 'audio-fingerprint'], { 'audio-fingerprint': 'audio signature' }))
      .toBe('We found your audio signature, plus 1 more thing.');
  });
  it('falls back to a plain count when none of the top six exist', () => {
    expect(buildTeaser(['device', 'browser'], {})).toBe('We found 2 things your browser tells every site.');
  });
});

describe('Alice script (CK-8313)', () => {
  it('keeps exactly the bottom fifteen quiet and none of the top six', () => {
    expect(ALICE_QUIET_IDS.size).toBe(15);
    for (const id of TOP_SIX_IDS) expect(ALICE_QUIET_IDS.has(id)).toBe(false);
    expect(ALICE_QUIET_IDS.has('primary-language')).toBe(true);
  });
  it('has no percentage, "we know" or alarm words in any new Alice line', () => {
    const lines = [ALICE_INTRO, ALICE_WEBRTC_LEAK, aliceQuietLine('Browser', 'Chrome 141'), ...Object.values(TOP_SIX_EXPLAINERS)];
    for (const s of lines) expect(s).not.toMatch(/%|we know|critical|danger|attacker/i);
  });
  it('does not say "hover" in the intro and mentions tapping', () => {
    expect(ALICE_INTRO).not.toMatch(/hover/i);
    expect(ALICE_INTRO).toMatch(/tap/i);
  });
});
