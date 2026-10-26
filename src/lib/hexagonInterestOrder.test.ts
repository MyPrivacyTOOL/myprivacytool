import { describe, it, expect } from 'vitest';
import { HEXAGON_INTEREST_ORDER, interestRank } from './hexagonInterestOrder';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';

describe('hexagon interest order (CK-7799)', () => {
  const webIds = HEXAGONS.map((h: { id: string }) => h.id);
  it('lists every registry web hexagon exactly once', () => {
    expect(new Set(HEXAGON_INTEREST_ORDER).size).toBe(HEXAGON_INTEREST_ORDER.length);
    expect([...HEXAGON_INTEREST_ORDER].sort()).toEqual([...webIds].sort());
  });
  it('puts the leak and fingerprint hexagons first', () => {
    expect(HEXAGON_INTEREST_ORDER.slice(0, 3)).toEqual(['webrtc-leak', 'canvas-fingerprint', 'dns-leak']);
  });
  it('ranks unknown ids after every listed id', () => {
    expect(interestRank('not-a-hexagon')).toBeGreaterThan(interestRank('primary-language'));
  });
});
