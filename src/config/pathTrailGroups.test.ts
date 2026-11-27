import { describe, expect, it } from 'vitest';
import { TRAIL_GROUPS } from './pathTrailGroups';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';

const registry = HEXAGONS as { id: string; group: string }[];

describe('trail groups use exactly the registry members', () => {
  for (const g of TRAIL_GROUPS) {
    it(`${g.group}: every tile is in the registry group, none missing, none repeated`, () => {
      const real = registry.filter((h) => h.group === g.group).map((h) => h.id).sort();
      expect([...g.order].sort()).toEqual(real);
      expect(new Set(g.order).size).toBe(g.order.length);
    });
    it(`${g.group}: the row shape adds up to the tile count and no row is wider than 3`, () => {
      expect(g.rows.reduce((a, b) => a + b, 0)).toBe(g.order.length);
      g.rows.forEach((n) => { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(3); });
    });
    it(`${g.group}: sample states only name tiles in the group`, () => {
      for (const id of Object.keys(g.sample ?? {})) expect(g.order).toContain(id);
    });
  }
  it('covers every web-scan group except Browser Fingerprint, which has its own picture', () => {
    const groups = new Set(registry.map((h) => h.group));
    groups.delete('Browser Fingerprint');
    expect(new Set(TRAIL_GROUPS.map((g) => g.group))).toEqual(groups);
  });
});
