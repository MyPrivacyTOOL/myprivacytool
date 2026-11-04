// First-touch campaign attribution for GA4 custom event parameters (MPC-7182).
// Kept in memory only (no cookies or storage): it survives in-app navigation (blog -> /scan -> scan)
// but not a full reload, which keeps the privacy posture of the site intact.

export const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
export type Attribution = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>>;

const MAX_LEN = 100;
let firstTouch: Attribution | null = null;

/** utm_* params found in a query string, trimmed and length-capped; empty object if none. */
export function parseAttribution(search: string): Attribution {
  const q = new URLSearchParams(search);
  const out: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const v = q.get(key)?.trim();
    if (v) out[key] = v.slice(0, MAX_LEN);
  }
  return out;
}

/** Remember the first utm_source seen this page session; later links never overwrite it. */
export function captureAttribution(search: string): void {
  if (firstTouch) return;
  const found = parseAttribution(search);
  if (found.utm_source) firstTouch = found;
}

export function getAttribution(): Attribution {
  return firstTouch ? { ...firstTouch } : {};
}

export function resetAttributionForTests(): void {
  firstTouch = null;
}
