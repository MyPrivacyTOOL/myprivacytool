import { describe, it, expect } from 'vitest';
import { aliceTileMessage } from './scanCopy';
import { toTile } from './hexagonTile';

const hex = (over = {}) => ({ id: 'device', label: 'Device Type', value: 'Desktop (Windows 11)', explanation: 'Your browser reports this.', ...over });
const tileOf = (h: { id: string; value: string }) => toTile({ id: h.id, value: h.value });

describe('aliceTileMessage', () => {
  it('a tile that shows its value says the value, how we know, and the explanation; no percentage, no "click to confirm"', () => {
    const h = hex();
    const m = aliceTileMessage(h, tileOf(h), 3);
    expect(m).toMatch(/^Device Type: Desktop \(Windows 11\)\. /);
    expect(m).toMatch(/Your browser reports this\./);
    expect(m).not.toMatch(/%|click to confirm|data points|without asking/i);
  });

  it('a tile that makes no claim: only why, never its value, a number, risk text or clean wording', () => {
    const h = hex({ id: 'dns-leak', label: 'DNS Leak', value: 'No Leak Detected', risk: 'Attackers can see your lookups.' });
    const m = aliceTileMessage(h, tileOf(h), 3);
    expect(m).toMatch(/DNS Leak: A web page can't check this/);
    expect(m).not.toMatch(/No Leak|\d|%|Attackers|safe|clean|looks normal/i);
  });

  it('a code or a value cut short with dots is not read out; the pause dot in a tile line is not spoken', () => {
    const c = hex({ id: 'canvas-fingerprint', label: 'Canvas Fingerprint', value: 'a3f9c21e....' });
    expect(aliceTileMessage(c, tileOf(c), 3)).toMatch(/^Canvas Fingerprint: a long technical code\. /);
    expect(aliceTileMessage(c, tileOf(c), 3)).not.toMatch(/a3f9|\.{2,}|…/);
    const d = hex();
    expect(aliceTileMessage(d, tileOf(d), 3)).toMatch(/Seen, low risk\./);
    expect(aliceTileMessage(d, tileOf(d), 3)).not.toMatch(/·/);
  });

  it('a guess says it is a guess once, not twice', () => {
    const h = hex({ id: 'location', label: 'Location', value: 'Springfield', explanation: 'Looked up from your IP address.' });
    const m = aliceTileMessage(h, tileOf(h), 3);
    expect(m.match(/our guess/gi)).toHaveLength(1);
  });

  it('a guess says it is a guess; with nothing hovered she gives the intro, then the nudge, without counts or "confirm"', () => {
    const h = hex({ id: 'location', label: 'Location', value: 'Springfield', explanation: 'Looked up from your IP address.' });
    expect(aliceTileMessage(h, tileOf(h), 0)).toMatch(/our guess/i);
    const intro = aliceTileMessage(null, undefined, 0);
    const next = aliceTileMessage(null, undefined, 4);
    for (const m of [intro, next]) expect(m).not.toMatch(/\d|%|confirm|without asking|data points/i);
    expect(intro).not.toBe(next);
  });
});
