// CK-11491: the two parameters every funnel event carries, channel and utm_source. No personal data can get through:
// channel comes from a closed list, and utm_source (which anyone can type into a link) is kept only if it is a short campaign slug.
import { getAttribution, type Attribution } from "./attribution";

export type FunnelChannel = "paid" | "email" | "bot" | "social" | "organic_search" | "referral" | "campaign" | "direct";

const SOCIAL_SOURCE = /^(x|twitter|t\.co|facebook|fb|instagram|ig|linkedin|reddit|youtube|tiktok|threads|telegram|whatsapp)$/;
const SOCIAL_HOST = /(^|\.)(t\.co|x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|reddit\.com|youtube\.com|youtu\.be|tiktok\.com|threads\.net|t\.me|telegram\.org|whatsapp\.com)$/;
const SEARCH_HOST = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|baidu\.com|yandex\.[a-z]+|ecosia\.org|search\.brave\.com)$/;

/** The utm_source as sent to GA4: "(none)" when there is none, "invalid" when it is not a plain campaign slug (an address, a number, free text). */
export function safeUtmSource(raw: string | undefined): string {
  const v = raw?.trim().toLowerCase();
  if (!v) return "(none)";
  return /^[a-z0-9._-]{1,40}$/.test(v) && !/\d{7,}/.test(v) ? v : "invalid";
}

/** Where the visit came from. utm_medium wins, then utm_source, then the referring site. The referrer itself is never sent. */
export function deriveChannel(utm: Attribution, referrer: string, ownHost: string): FunnelChannel {
  const medium = utm.utm_medium?.trim().toLowerCase() ?? "";
  const source = utm.utm_source?.trim().toLowerCase() ?? "";
  if (/^(cpc|ppc|paid.*|display|ads?)$/.test(medium)) return "paid";
  if (/^(e-?mail|newsletter)$/.test(medium)) return "email";
  if (medium === "channel_osint" || medium === "bot") return "bot";
  if (/^social/.test(medium) || SOCIAL_SOURCE.test(source)) return "social";
  if (source) return "campaign";
  let host = "";
  try {
    host = referrer ? new URL(referrer).hostname.toLowerCase() : "";
  } catch {
    host = "";
  }
  const bare = (h: string) => h.replace(/^www\./, "");
  if (!host || bare(host) === bare(ownHost.toLowerCase())) return "direct";
  if (SEARCH_HOST.test(host)) return "organic_search";
  if (SOCIAL_HOST.test(host)) return "social";
  return "referral";
}

export function funnelParams(): { channel: FunnelChannel; utm_source: string } {
  const utm = getAttribution();
  const hasWindow = typeof window !== "undefined";
  return {
    channel: deriveChannel(utm, hasWindow ? document.referrer : "", hasWindow ? window.location.hostname : ""),
    utm_source: safeUtmSource(utm.utm_source),
  };
}
