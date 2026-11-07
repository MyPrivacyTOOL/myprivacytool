// The "Your Device" card (live device image, tilt readouts) at the top of the home page.
// OFF by default while the experience is being reworked. Turn it back on for a build with VITE_DEVICE_HERO="true" (also "1", "on", "yes"),
// or preview it in any browser tab with ?view=device (never stored, does nothing to other visitors).
// Read at call time so tests can change it.

const ON = ['true', '1', 'on', 'yes'];

function buildDefault(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ON.includes(raw.trim().toLowerCase());
}

export function deviceHeroEnabled(search?: string): boolean {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    if (/[?&]view=device(&|$)/.test(q)) return true;
  } catch {
    /* no window or blocked: use the build setting */
  }
  return buildDefault(import.meta.env.VITE_DEVICE_HERO);
}
