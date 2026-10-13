// Hong Kong Do-not-call (DNC) registration: single source of truth for the dial string and IVR key
// sequences (MPC-7450). The landing page (MPC-7446) and the day-10 email (MPC-7448) read from here only.
//
// !! IVR_VERIFIED = false !!  The hotline, the 1357 caller-ID prefix and the 10-working-day rule come from the
// OFCA public FAQ. The key presses live in hkDncIvr.json: they were typed down by hand from a real call on 2026-10-13
// (language, then service, then 1 = register the number you call from; star = back to menu). No key is VERIFIED until
// the tap-to-dial flow has worked on real phones (MPC-7540). While IVR_VERIFIED is false the page must stay noindex,
// unlinked and without paid traffic, and must not claim that the keys auto-send correctly.
//
// OFCA cannot register on the user's behalf: the call has to come from the number being registered, so the
// "engine" only builds the tap-to-dial string and the on-screen script.

import ivrJson from "./hkDncIvr.json";

export const HK_DNC_HOTLINE = "1835000";
/** Dial before the hotline when outgoing caller ID is withheld; harmless when it is already shown. */
export const HK_CALLER_ID_PREFIX = "1357";

/** Flip to true ONLY after MPC-7445 has recorded the real IVR menu in docs/hk-dnc-ivr-procedure.md. */
export const IVR_VERIFIED = false;

/**
 * Kill switch for /HongKongSpam and every HK card (homepage, report). Defaults to true; set the build variable
 * VITE_HK_SPAM_ENABLED to "false" (or "0", "off", "no") and rebuild to hide all HK surfaces at once. This is
 * independent of the `public` launch flag in src/data/hkSpam.json: both must allow the page to show it.
 */
export function parseHkSpamEnabled(raw: unknown): boolean {
  if (typeof raw !== "string") return true;
  return !["false", "0", "off", "no"].includes(raw.trim().toLowerCase());
}

export const HK_SPAM_ENABLED: boolean = parseHkSpamEnabled(import.meta.env.VITE_HK_SPAM_ENABLED);

/** "all" registers short messages and then pre-recorded in ONE call (star goes back to the menu in between).
 *  Fax is left out on purpose: the hotline offers it but nobody uses it. */
export type HkRegister = "sms" | "prerecorded" | "all";
export type HkLanguage = "en" | "yue";
export type HkPlatform = "android" | "ios" | "other";

export type IvrStatus = "UNVERIFIED" | "REPORTED" | "VERIFIED";

export interface IvrKey {
  /** DTMF character: 0-9, * or #. */
  key: string;
  /** What the key is for, shown on screen (iOS / desktop) as the manual script. */
  purpose: "language" | "service" | "register" | "back";
  /** UNVERIFIED = guess, REPORTED = heard once, VERIFIED = confirmed. */
  status: IvrStatus;
}

export const HK_REGISTERS: readonly HkRegister[] = ["sms", "prerecorded", "all"];

// The keys and pauses live in hkDncIvr.json so they can be changed later without touching code.
interface KeyEntry {
  key: string;
  status: IvrStatus;
}
interface IvrData {
  pauses: { beforeFirstKey: number; betweenKeys: number; afterRegister: number };
  language: Record<HkLanguage, KeyEntry>;
  services: Record<"sms" | "prerecorded", KeyEntry>;
  register: KeyEntry;
  back: KeyEntry;
}
export const IVR_DATA: IvrData = ivrJson as unknown as IvrData;

/**
 * Android dialers treat "," as a ~2 second pause. UNVERIFIED on a real phone. The hotline accepts keys before the
 * spoken menu ends, so the pauses are short; afterRegister waits for the "registered" message before pressing star.
 */
export const PAUSES = IVR_DATA.pauses;

/** Ordered keys for one service: service choice, then 1 = register the number you are calling from. */
function serviceKeys(service: "sms" | "prerecorded"): IvrKey[] {
  return [
    { ...IVR_DATA.services[service], purpose: "service" },
    { ...IVR_DATA.register, purpose: "register" },
  ];
}

/**
 * The ordered keys to press: language, then service + register for each service. "all" chains short messages and
 * pre-recorded in one call, pressing star (back to menu) in between.
 */
export function getIvrKeys(register: HkRegister, language: HkLanguage = "en"): IvrKey[] {
  const lang: IvrKey = { ...IVR_DATA.language[language], purpose: "language" };
  if (register === "sms" || register === "prerecorded") return [lang, ...serviceKeys(register)];
  return [lang, ...serviceKeys("sms"), { ...IVR_DATA.back, purpose: "back" }, ...serviceKeys("prerecorded")];
}

export interface DialOptions {
  register?: HkRegister;
  language?: HkLanguage;
  /** Prefix 1357 so caller ID is shown even if the user withholds it. Default true. */
  forceCallerId?: boolean;
}

export interface DialResult {
  platform: HkPlatform;
  /** Ready for <a href>. Percent-encoded. */
  dial: string;
  /** Keys the page shows on screen: the manual script on desktop, and the backup (in large type) on iPhone.
   *  Empty on Android, where the dial string sends them. */
  manualKeys: IvrKey[];
  /** True when the dial string itself carries the keys with pauses (Android and iPhone). */
  autoKeys: boolean;
  /** Always mirrors IVR_VERIFIED so callers cannot present unverified keys as working. */
  verified: boolean;
}

// tel: URIs: keep "," (pause) literal, percent-encode everything else (notably # and *, which would otherwise
// be read as a URL fragment / reserved character).
function encodeTelSegment(s: string): string {
  // encodeURIComponent leaves "*" alone, so encode it explicitly (star = back to menu); "#" is already encoded.
  return encodeURIComponent(s).replace(/%2C/gi, ",").replace(/\*/g, "%2A");
}

export function buildDialString(platform: HkPlatform, options: DialOptions = {}): DialResult {
  const { register = "all", language = "en", forceCallerId = true } = options;
  const number = (forceCallerId ? HK_CALLER_ID_PREFIX : "") + HK_DNC_HOTLINE;
  const keys = getIvrKeys(register, language);

  if (platform === "android" || platform === "ios") {
    // Both phones honour "," as a pause in a tel: link. A longer wait before star lets the "registered" message play first.
    const parts = keys.map((k, i) => {
      const pause = i === 0 ? PAUSES.beforeFirstKey : k.purpose === "back" ? PAUSES.afterRegister : PAUSES.betweenKeys;
      return ",".repeat(pause) + k.key;
    });
    return {
      platform,
      dial: `tel:${encodeTelSegment(number + parts.join(""))}`,
      // iPhone also gets the keys on screen as a backup in case the dialer ignores the pauses.
      manualKeys: platform === "ios" ? keys : [],
      autoKeys: true,
      verified: IVR_VERIFIED,
    };
  }

  // Desktop / unknown: bare number; the user presses the keys while the page shows them.
  return {
    platform,
    dial: `tel:${encodeTelSegment(number)}`,
    manualKeys: keys,
    autoKeys: false,
    verified: IVR_VERIFIED,
  };
}
