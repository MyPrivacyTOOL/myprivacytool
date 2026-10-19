import { describe, it, expect } from 'vitest';
import { buildTeaser, TOP_SIX_EXPLAINERS, TOP_SIX_IDS } from './exposureCopy';

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
