// Pure helpers for the /HongKongSpam page (MPC-7446): platform detection, the honest dial view, language
// selection and date formatting. Kept free of React so they are unit-tested directly.
import { buildDialString, getIvrKeys, type HkLanguage, type HkPlatform, type IvrKey } from "@/config/hkDnc";

export type PageLang = "en" | "zh";
export const LANG_STORAGE_KEY = "mpt_hk_lang";

/** android / ios / other (desktop, unknown) from the user agent. iPadOS reports a Mac UA, so touch points decide. */
export function detectHkPlatform(userAgent: string, maxTouchPoints = 0): HkPlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "other";
}

/** Page language to IVR menu language: Traditional Chinese visitors get the Cantonese menu. */
export function ivrLanguage(lang: PageLang): HkLanguage {
  return lang === "zh" ? "yue" : "en";
}

export interface HkDialView {
  /** href for the big button. */
  dial: string;
  /** Keys to display (in order). Empty when keys must not be shown (unverified, not a preview). */
  keys: IvrKey[];
  /** True when the dial string itself sends the keys (Android, keys shown). */
  autoKeys: boolean;
  /** True when the keys on screen are placeholders: only ever true for an internal preview. */
  keysUnverified: boolean;
  /** True when the page must not list menu keys at all (unverified, public audience). */
  keysHidden: boolean;
  /** Dialling only works from a phone. */
  needsPhone: boolean;
}

/**
 * What the page may show. While IVR_VERIFIED is false (MPC-7445 pending), the public sees a plain dial of
 * 1357 + 1835000 and a "follow the spoken menu" step: no keys, no auto-key claim. Internal preview sees the
 * placeholder keys with an "unverified" banner. Once IVR_VERIFIED is true everyone gets the full flow.
 */
export function resolveHkDial(platform: HkPlatform, lang: PageLang, preview: boolean): HkDialView {
  const language = ivrLanguage(lang);
  const full = buildDialString(platform, { register: "all", language });
  const showKeys = full.verified || preview;
  if (!showKeys) {
    return {
      dial: buildDialString("other", { register: "all", language }).dial,
      keys: [],
      autoKeys: false,
      keysUnverified: false,
      keysHidden: true,
      needsPhone: platform === "other",
    };
  }
  return {
    dial: full.dial,
    keys: getIvrKeys("all", language),
    autoKeys: full.autoKeys,
    keysUnverified: !full.verified,
    keysHidden: false,
    needsPhone: platform === "other",
  };
}

/** Stored choice, then ?lang=, then the browser language (any zh* means Traditional Chinese), else English. */
export function pickInitialLang(search: string, stored: string | null, navigatorLanguages: readonly string[]): PageLang {
  const q = new URLSearchParams(search).get("lang");
  if (q === "zh" || q === "en") return q;
  if (stored === "zh" || stored === "en") return stored;
  return navigatorLanguages.some((l) => /^zh\b/i.test(l)) ? "zh" : "en";
}

export function readInitialLang(): PageLang {
  if (typeof window === "undefined") return "en";
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    // storage blocked
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language ?? "en"];
  return pickInitialLang(window.location.search, stored, langs);
}

export function storeLang(lang: PageLang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // storage blocked: the choice just does not stick
  }
}

/** 'YYYY-MM-DD' (a Hong Kong calendar date) as a long date in the page language. */
export function formatHkDate(iso: string, lang: PageLang): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-HK" : "en-HK", { dateStyle: "full", timeZone: "UTC" }).format(d);
}

// "Didn't work?" on /HongKongSpam links here with ?source=hk-spam&platform=..&lang=.. (MPC-7446). Only known values
// are accepted, so the query string cannot inject text into the message.
export function hkSpamContactPrefill(params: URLSearchParams): string {
  if (params.get("source") !== "hk-spam") return "";
  const platform = ["android", "ios", "other"].find((p) => p === params.get("platform")) ?? "unknown";
  const lang = ["en", "zh"].find((l) => l === params.get("lang")) ?? "unknown";
  return `Hong Kong Stop Spam did not work for me.\nWhat happened: \n\n(Phone type: ${platform}. Page language: ${lang}.)`;
}
