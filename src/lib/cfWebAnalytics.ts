// MPC-7381: Cloudflare Web Analytics (RUM) beacon. Cookieless; loads only when VITE_CF_WEB_ANALYTICS_TOKEN is set at build time.
// MPC-9057: and only after the visitor chose "Accept analytics" (see loadCfWebAnalyticsWhenConsented).
import { hasConsent, onConsentChange } from "./cookieConsent";
import { recipientScript } from "./recipientClient";
const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

// MPC-9886: the load goes through the recipient registry ("cloudflare-web-analytics", basis analytics_consent). The wrapper adds the <script> a tick later, so a
// second call in that gap must not start a second load: `requested` closes it.
const requested = new WeakSet<Document>();

export function loadCfWebAnalytics(token = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN as string | undefined, doc: Document = document): boolean {
  const t = token?.trim();
  if (!t || requested.has(doc) || doc.querySelector(`script[src="${BEACON_SRC}"]`)) return false;
  requested.add(doc);
  void recipientScript("cloudflare-web-analytics", BEACON_SRC, { defer: "", "data-cf-beacon": JSON.stringify({ token: t }) }, doc).catch(() => {
    requested.delete(doc); // refused or blocked: a later consent change may try again
  });
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
