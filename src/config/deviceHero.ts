// The full-screen device reveal at the top of the home page (src/components/DeviceRevealScreen.tsx).
// ON by default. Turn it off for a build with VITE_DEVICE_HERO="false" (also "0", "off", "no").
// ?view=device forces it on in any browser tab (never stored, does nothing to other visitors); CI builds with it off so the
// other end-to-end specs are not covered by the overlay, and e2e/device-reveal.spec.ts uses ?view=device to test it.
// Read at call time so tests can change it.

const OFF = ['false', '0', 'off', 'no'];

function buildDefault(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  return !OFF.includes(raw.trim().toLowerCase());
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
