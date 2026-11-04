// The honeycomb dashboard (src/components/dashboard) in place of the grid on the scan results.
// ON by default. Turn it off for a build with VITE_HONEYCOMB_DASHBOARD="false" (also "0", "off", "no"), or see the grid in any browser
// tab with ?view=grid (never stored, does nothing to other visitors). ?view=honeycomb forces the dashboard even when the build has it off.
// Read at call time so tests can change it.

const OFF = ['false', '0', 'off', 'no'];

function buildDefault(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  return !OFF.includes(raw.trim().toLowerCase());
}

export function honeycombDashboardEnabled(search?: string): boolean {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    if (/[?&]view=grid(&|$)/.test(q)) return false;
    if (/[?&]view=honeycomb(&|$)/.test(q)) return true;
  } catch {
    /* no window or blocked: use the build setting */
  }
  return buildDefault(import.meta.env.VITE_HONEYCOMB_DASHBOARD);
}
