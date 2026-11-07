import { describe, it, expect } from 'vitest';
import { firstSpinDelay, SPIN_SLOW_DOWN, SPIN_TOTAL_MS } from './revealSpin';

describe('firstSpinDelay', () => {
  it('makes every spin last about the same total, from a short or a long run', () => {
    for (const steps of [8, 11, 15]) {
      let delay = firstSpinDelay(steps);
      let total = 0;
      for (let i = 0; i < steps; i++) {
        total += delay;
        delay *= SPIN_SLOW_DOWN;
      }
      expect(Math.abs(total - SPIN_TOTAL_MS)).toBeLessThan(1);
    }
  });

  it('starts slower than the old 55ms for the shortest run', () => {
    expect(firstSpinDelay(8)).toBeGreaterThan(150);
  });
});
