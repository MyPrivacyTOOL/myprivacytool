// The honeycomb dashboard (src/components/dashboard) in place of the grid on the scan results.
// OFF by default. Turn it on for a build with VITE_HONEYCOMB_DASHBOARD="true" (also "1", "on", "yes"), or look at it in any browser
// tab with ?view=honeycomb (never stored, does nothing to other visitors). ?view=grid forces the grid even when the build has it on.
// Read at call time so tests can change it.

function parse(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function honeycombDashboardEnabled(search?: string): boolean {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    if (/[?&]view=honeycomb(&|$)/.test(q)) return true;
    if (/[?&]view=grid(&|$)/.test(q)) return false;
  } catch {
    /* no window or blocked: use the build setting */
  }
  return parse(import.meta.env.VITE_HONEYCOMB_DASHBOARD);
}
