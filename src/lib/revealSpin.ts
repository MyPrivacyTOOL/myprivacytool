/** The reveal spin always takes about this long, wherever it lands, and slows as it goes. */
export const SPIN_TOTAL_MS = 3200;
export const SPIN_SLOW_DOWN = 1.1;

/** First delay such that `steps` delays, each SPIN_SLOW_DOWN times the last, add up to SPIN_TOTAL_MS. */
export function firstSpinDelay(steps: number): number {
  return (SPIN_TOTAL_MS * (SPIN_SLOW_DOWN - 1)) / (Math.pow(SPIN_SLOW_DOWN, steps) - 1);
}
