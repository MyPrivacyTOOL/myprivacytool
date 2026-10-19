import { describe, it, expect } from 'vitest';
import { hiveLayout, HEX_RATIO } from './honeycomb';

describe('hiveLayout', () => {
  it('caps at four per row on any wide screen, so nine tiles are 4 + 4 + 1', () => {
    for (const w of [420, 480, 704, 1024, 1600]) {
      const l = hiveLayout(9, w);
      expect(l.cols).toBe(4);
      expect(l.positions.filter((p) => p.top === 0)).toHaveLength(4);
      expect(l.positions.filter((p) => p.top === l.positions[8].top)).toHaveLength(1);
    }
  });
  it('shifts odd rows half a tile across and overlaps rows by a quarter', () => {
    const l = hiveLayout(8, 600);
    const step = l.hw + 4;
    expect(l.positions[4].left - l.positions[0].left).toBe(step / 2);
    expect(l.positions[0].top).toBe(0);
    expect(l.positions[4].top).toBeLessThan(l.hw * HEX_RATIO);
  });
  it('fits a phone held upright: smaller tiles, three per row, inside the container', () => {
    for (const w of [320, 360, 390, 400]) {
      const l = hiveLayout(9, w);
      expect(l.compact).toBe(true);
      expect(l.cols).toBeGreaterThanOrEqual(2);
      if (w >= 360) expect(l.cols).toBe(3);
      expect(l.width).toBeLessThanOrEqual(Math.max(w, 2.5 * (l.hw + 4)));
    }
  });
  it('always fits the container once four tiles are possible, at every width', () => {
    for (let w = 420; w <= 1400; w += 7) expect(hiveLayout(9, w).width).toBeLessThanOrEqual(w);
  });
  it('uses a sane default when the width is unknown and handles an empty pillar', () => {
    expect(hiveLayout(9, 0).cols).toBe(4);
    expect(hiveLayout(0, 600)).toMatchObject({ height: 0, positions: [] });
  });
});
