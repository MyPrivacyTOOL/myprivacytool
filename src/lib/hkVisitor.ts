// Is this visitor in Hong Kong? (MPC-7450)
// Source of truth is Cloudflare's CF-IPCountry header, served by the Pages Function functions/api/hk-geo.ts.
// A visitor with a Hong Kong number who is abroad (or on a VPN) can say so with the manual override, which is
// remembered on their device only (localStorage). Nothing is sent to a server and no identifier is created.

export const HK_OVERRIDE_KEY = "mpt_hk_number_override";
export const HK_GEO_ENDPOINT = "/api/hk-geo";

function readOverride(): boolean {
  try {
    return localStorage.getItem(HK_OVERRIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/** "I have a Hong Kong number": persists for this visitor's browser. Pass false to clear it. */
export function setHongKongOverride(on: boolean): void {
  try {
    if (on) localStorage.setItem(HK_OVERRIDE_KEY, "1");
    else localStorage.removeItem(HK_OVERRIDE_KEY);
  } catch {
    // storage blocked (private window): the override just does not stick
  }
}

export function hasHongKongOverride(): boolean {
  return readOverride();
}

let geoCache: Promise<string | null> | undefined;

function fetchCountry(): Promise<string | null> {
  geoCache ??= fetch(HK_GEO_ENDPOINT, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { country?: string | null } | null) => j?.country ?? null)
    .catch(() => null);
  return geoCache;
}

/** Test hook: forget the cached lookup. */
export function resetHkGeoCache(): void {
  geoCache = undefined;
}

/** True when the manual override is set or Cloudflare says the request came from Hong Kong. Fails closed. */
export async function isHongKongVisitor(): Promise<boolean> {
  if (readOverride()) return true;
  return (await fetchCountry()) === "HK";
}
