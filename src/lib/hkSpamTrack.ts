// GA4 events for the Hong Kong spam-call funnel (MPC-7450). Thin wrapper over trackEvent() in analytics.ts, so
// it inherits the same consent gating (events only reach GA4 once the CMP allows it). No PII: never pass an
// email or phone number in params.
import { trackEvent } from "./analytics";

export const HK_SPAM_EVENTS = [
  "hk_spam_view",
  "hk_spam_dial_tap",
  "hk_spam_registered",
  "hk_spam_email_submit",
  "hk_spam_optout_generated",
  "hk_spam_log_added",
  "hk_spam_scan_click",
  "hk_spam_lang_switch",
] as const;

export type HkSpamEvent = (typeof HK_SPAM_EVENTS)[number];
export type HkSpamParams = Record<string, string | number | boolean>;

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
export const UTM_STORAGE_KEY = "mpt_hk_utm";

type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

/** UTM params in a query string; values are trimmed and capped at 100 chars. */
export function parseUtm(search: string): Utm {
  const out: Utm = {};
  const qs = new URLSearchParams(search);
  for (const k of UTM_KEYS) {
    const v = qs.get(k)?.trim().slice(0, 100);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * UTM for this visit: the current URL wins; otherwise what was remembered for this tab session, so the
 * attribution survives in-page navigation (sessionStorage, cleared when the tab closes).
 */
export function getUtm(): Utm {
  if (typeof window === "undefined") return {};
  const fromUrl = parseUtm(window.location.search);
  try {
    if (Object.keys(fromUrl).length) {
      sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(fromUrl));
      return fromUrl;
    }
    const stored = sessionStorage.getItem(UTM_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Utm) : {};
  } catch {
    return fromUrl;
  }
}

/** Send one HK spam funnel event with the visit's UTM params attached. */
export function track(event: HkSpamEvent, params: HkSpamParams = {}): void {
  trackEvent(event, { ...getUtm(), ...params });
}
