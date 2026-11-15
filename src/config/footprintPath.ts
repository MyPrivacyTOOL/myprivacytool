// MPC-10614: the Footprint Path switch (design brief v1, Telegram arrival). OFF by default in every environment.
// Turn it on for a build with VITE_FOOTPRINT_PATH="true" (also "1", "on", "yes"). Preview in any browser tab with ?path=1 (never stored, changes nothing
// for other visitors). The old VITE_FOOTPRINTS_CUE switch (src/config/footprints.ts) is a different feature and is untouched. Read at call time so tests can change it.

export function parseFootprintPath(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

const has = (q: string, key: string, value: string): boolean => new RegExp(`[?&]${key}=${value}(&|$)`).test(q);
const search = (s?: string): string => {
  try { return s ?? (typeof window !== 'undefined' ? window.location.search : ''); } catch { return ''; }
};

/** The switch: ?path=1 in the address, or the build setting. */
export function footprintPathEnabled(s?: string): boolean {
  if (has(search(s), 'path', '1')) return true;
  return parseFootprintPath(import.meta.env.VITE_FOOTPRINT_PATH);
}

/** Preview mode: the page was opened with ?path=1. Only a preview may show SAMPLE DATA (the owner's test-account shape); a build-flag visitor never does. */
export const footprintPathPreview = (s?: string): boolean => has(search(s), 'path', '1');

export type PreviewFrame = 'arrival' | 'confirmed' | 'prize';
/** ?frame=confirmed | prize pre-sets the sample for the design review screenshots. Honoured only in preview. */
export function previewFrame(s?: string): PreviewFrame {
  const m = /[?&]frame=(confirmed|prize)(&|$)/.exec(search(s));
  return (m?.[1] as PreviewFrame | undefined) ?? 'arrival';
}
/** ?test=1 (preview only) shows the allow-listed test-account shape: five arrival prints instead of four (brief decision 4). */
export const previewAllowListed = (s?: string): boolean => has(search(s), 'test', '1');
