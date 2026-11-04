// MPC-7381: Cloudflare Web Analytics (RUM) beacon. Cookieless; loads only when VITE_CF_WEB_ANALYTICS_TOKEN is set at build time.
// MPC-9057: and only after the visitor chose "Accept analytics" (see loadCfWebAnalyticsWhenConsented).
import { hasConsent, onConsentChange } from "./cookieConsent";
const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

export function loadCfWebAnalytics(token = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN as string | undefined, doc: Document = document): boolean {
  const t = token?.trim();
  if (!t || doc.querySelector(`script[src="${BEACON_SRC}"]`)) return false;
  const s = doc.createElement("script");
  s.defer = true;
  s.src = BEACON_SRC;
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: t }));
  doc.head.appendChild(s);
  return true;
}

/**
 * Loads the beacon only once the visitor has accepted analytics: at once if they already did on an earlier visit, or the
 * moment they accept. Before that no request to cloudflareinsights.com is made. (A beacon already loaded cannot be
 * unloaded; withdrawing consent takes effect on the next page load.) Returns the unsubscribe function.
 */
export function loadCfWebAnalyticsWhenConsented(
  load: () => boolean = loadCfWebAnalytics,
  consented: () => boolean = hasConsent,
  subscribe: (cb: () => void) => () => void = onConsentChange,
): () => void {
  if (consented()) load();
  return subscribe(() => {
    if (consented()) load();
  });
}
