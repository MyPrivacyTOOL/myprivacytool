import { describe, it, expect, afterEach, vi } from 'vitest';
import { honeycombDashboardEnabled } from './honeycombDashboard';

afterEach(() => vi.unstubAllEnvs());

describe('honeycombDashboardEnabled', () => {
  it('is on by default', () => {
    expect(honeycombDashboardEnabled('')).toBe(true);
    expect(honeycombDashboardEnabled('?other=1')).toBe(true);
  });
  it('?view=grid shows the grid in that tab only, and wins over everything', () => {
    expect(honeycombDashboardEnabled('?view=grid')).toBe(false);
    expect(honeycombDashboardEnabled('?a=1&view=grid&b=2')).toBe(false);
    expect(honeycombDashboardEnabled('?view=grids')).toBe(true);
  });
  it('the build can switch it off, and ?view=honeycomb still shows it', () => {
    for (const off of ['false', 'FALSE', '0', 'off', 'no', ' off ']) {
      vi.stubEnv('VITE_HONEYCOMB_DASHBOARD', off);
      expect(honeycombDashboardEnabled('')).toBe(false);
    }
    expect(honeycombDashboardEnabled('?view=honeycomb')).toBe(true);
    vi.stubEnv('VITE_HONEYCOMB_DASHBOARD', 'true');
    expect(honeycombDashboardEnabled('')).toBe(true);
    vi.stubEnv('VITE_HONEYCOMB_DASHBOARD', '');
    expect(honeycombDashboardEnabled('')).toBe(true);
  });
});
