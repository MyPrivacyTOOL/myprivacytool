import { describe, it, expect, afterEach, vi } from 'vitest';
import { honeycombDashboardEnabled } from './honeycombDashboard';

afterEach(() => vi.unstubAllEnvs());

describe('honeycombDashboardEnabled', () => {
  it('is off by default', () => {
    expect(honeycombDashboardEnabled('')).toBe(false);
    expect(honeycombDashboardEnabled('?other=1')).toBe(false);
  });
  it('?view=honeycomb turns it on for that tab only', () => {
    expect(honeycombDashboardEnabled('?view=honeycomb')).toBe(true);
    expect(honeycombDashboardEnabled('?a=1&view=honeycomb&b=2')).toBe(true);
    expect(honeycombDashboardEnabled('?view=honeycombs')).toBe(false);
  });
  it('the build setting turns it on, and ?view=grid still wins over it', () => {
    vi.stubEnv('VITE_HONEYCOMB_DASHBOARD', 'true');
    expect(honeycombDashboardEnabled('')).toBe(true);
    expect(honeycombDashboardEnabled('?view=grid')).toBe(false);
    vi.stubEnv('VITE_HONEYCOMB_DASHBOARD', 'maybe');
    expect(honeycombDashboardEnabled('')).toBe(false);
  });
});
