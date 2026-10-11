// MPC-7381: Cloudflare Web Analytics (RUM) beacon. Cookieless; loads only when VITE_CF_WEB_ANALYTICS_TOKEN is set at build time.
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
