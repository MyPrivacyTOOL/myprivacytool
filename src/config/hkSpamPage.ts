// /HongKongSpam launch switch and preview detection (MPC-7446).
//
// Two switches, both in src/data/hkSpam.json (the build scripts read the same file, scripts/hkSpamFlag.mjs, so the
// page, the prerendered head, the sitemap and robots.txt cannot disagree):
//  - `enabled`   HK_SPAM_ENABLED, the kill switch. False hides /HongKongSpam (404) and every HK card, and keeps the
//                page out of the sitemap. VITE_HK_SPAM_ENABLED=false does the same at build time.
//  - `indexable` HK_SPAM_INDEXABLE, the ONE SEO flag. False (the default) means noindex, not in the sitemap, disallowed
//                in robots.txt and not linked from the site (the homepage and report cards stay hidden). Flip it to
//                true only AFTER MPC-7445 has confirmed the IVR keys and IVR_VERIFIED in hkDnc.ts is true.
import hkSpam from "@/data/hkSpam.json";

export const HK_SPAM_ENABLED: boolean = hkSpam.enabled === true && import.meta.env.VITE_HK_SPAM_ENABLED !== "false";
export const HK_SPAM_INDEXABLE: boolean = HK_SPAM_ENABLED && hkSpam.indexable === true;
export const HK_SPAM_PATH: string = hkSpam.path;
export const HK_SPAM_META = { en: hkSpam.en, zh: hkSpam.zh } as const;

export const HK_PREVIEW_KEY = "mpt_hk_preview";
const PRODUCTION_HOSTS = ["www.myprivacytool.io", "myprivacytool.io"];

export interface PreviewInput {
  search: string;
  hostname: string;
  stored: string | null;
  dev: boolean;
}

/**
 * Internal / preview audiences see the "keys unverified" state and the cards before launch:
 * local dev, a Cloudflare Pages preview host, or `?hkpreview=1` (remembered for the tab; `?hkpreview=0` clears).
 */
export function computePreview({ search, hostname, stored, dev }: PreviewInput): boolean {
  const flag = new URLSearchParams(search).get("hkpreview");
  if (flag === "1") return true;
  if (flag === "0") return false;
  if (dev) return true;
  if (PRODUCTION_HOSTS.includes(hostname)) return stored === "1";
  if (hostname === "localhost" || hostname.endsWith(".pages.dev")) return true;
  return stored === "1";
}

export function isHkSpamPreview(): boolean {
  if (typeof window === "undefined") return false;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(HK_PREVIEW_KEY);
    const flag = new URLSearchParams(window.location.search).get("hkpreview");
    if (flag === "1") sessionStorage.setItem(HK_PREVIEW_KEY, "1");
    else if (flag === "0") sessionStorage.removeItem(HK_PREVIEW_KEY);
  } catch {
    // storage blocked: the query string alone still works for this page view
  }
  return computePreview({
    search: window.location.search,
    hostname: window.location.hostname,
    stored,
    dev: import.meta.env.DEV === true,
  });
}

/** True when the Stop Spam cards may render: switched on, and either launched or an internal preview. */
export function isHkSpamSurfaceEnabled(): boolean {
  return HK_SPAM_ENABLED && (HK_SPAM_INDEXABLE || isHkSpamPreview());
}
