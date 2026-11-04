import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CK-7805: the WebRTC and DNS plain-language text lives next to the detection code. Guard its tone.
const src = readFileSync('src/lib/deviceDetection.ts', 'utf8');
const strings = [...src.matchAll(/(?:webrtcExplanation|webrtcHeadline|dnsHexagon\.(?:headline|explanation)|headline|explanation)\s*[:=]\s*(['`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);

describe('leak explanations (CK-7805)', () => {
  it('found the strings', () => {
    expect(strings.length).toBeGreaterThan(10);
  });
  it('are calm: no alarm words, no percentages', () => {
    for (const t of strings) expect(t).not.toMatch(/critical|danger|attacker|we know|%/i);
  });
  it('every leaking case says it needs investigation', () => {
    expect(src).toMatch(/Your real address may be showing/);
    expect(src).toMatch(/Your lookups may be going the long way/);
    const leaking = strings.filter((t) => /may be showing|going the long way|real one|internet provider instead/.test(t) || /WebRTC \(made for video calls\)/.test(t));
    for (const t of leaking.filter((x) => x.length > 80)) expect(t).toMatch(/needs investigation/);
  });
});
