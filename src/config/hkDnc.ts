// Hong Kong Do-not-call (DNC) registration: single source of truth for the dial string and IVR key
// sequences (MPC-7450). The landing page (MPC-7446) and the day-10 email (MPC-7448) read from here only.
//
// !! IVR_VERIFIED = false !!  The hotline, the 1357 caller-ID prefix and the 10-working-day rule come from the
// OFCA public FAQ. The key presses live in hkDncIvr.json: the language keys and the "register a number" key were
// REPORTED on one call (2026-10-11); the register and confirm keys are still guesses. They need a trilingual
// speaker (MPC-7445 / MPC-7450-A2; docs/hk-dnc-ivr-procedure.md). While IVR_VERIFIED is false the page must stay noindex,
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

export type HkRegister = "sms" | "prerecorded" | "fax" | "all";
export type HkLanguage = "en" | "yue";
export type HkPlatform = "android" | "ios" | "other";

export type IvrStatus = "UNVERIFIED" | "REPORTED" | "VERIFIED";

export interface IvrKey {
  /** DTMF character: 0-9, * or #. */
  key: string;
  /** What the key is for, shown on screen (iOS / desktop) as the manual script. */
  purpose: "language" | "menu" | "register" | "confirm";
  /** UNVERIFIED = guess, REPORTED = heard once, VERIFIED = confirmed. */
  status: IvrStatus;
}

export const HK_REGISTERS: readonly HkRegister[] = ["sms", "prerecorded", "fax", "all"];

// The keys and pauses live in hkDncIvr.json so they can be changed later without touching code.
interface KeyEntry {
  key: string;
  status: IvrStatus;
}
interface IvrData {
  pauses: { beforeFirstKey: number; betweenKeys: number };
  language: Record<HkLanguage, KeyEntry>;
  menu: KeyEntry;
  registers: Record<HkRegister, [KeyEntry, KeyEntry]>;
}
export const IVR_DATA: IvrData = ivrJson as unknown as IvrData;

/**
 * Android dialers treat "," as a ~2 second pause. UNVERIFIED: the real greeting and prompt lengths are only
 * roughly known (about 10-12 s before the language menu), so these are deliberately generous.
 */
export const PAUSES = IVR_DATA.pauses;

/** The ordered keys to press for a language and register: language, menu, register choice, confirm. */
export function getIvrKeys(register: HkRegister, language: HkLanguage = "en"): IvrKey[] {
  const [choice, confirm] = IVR_DATA.registers[register];
  return [
    { ...IVR_DATA.language[language], purpose: "language" },
    { ...IVR_DATA.menu, purpose: "menu" },
    { ...choice, purpose: "register" },
    { ...confirm, purpose: "confirm" },
  ];
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
  /** Keys the user must press by hand and the page must show on screen. Empty when Android auto-sends them. */
  manualKeys: IvrKey[];
  /** True when the dial string itself carries the keys (Android). */
  autoKeys: boolean;
  /** Always mirrors IVR_VERIFIED so callers cannot present unverified keys as working. */
  verified: boolean;
}

// tel: URIs: keep "," (pause) literal, percent-encode everything else (notably # and *, which would otherwise
// be read as a URL fragment / reserved character).
function encodeTelSegment(s: string): string {
  return encodeURIComponent(s).replace(/%2C/gi, ",");
}

export function buildDialString(platform: HkPlatform, options: DialOptions = {}): DialResult {
  const { register = "all", language = "en", forceCallerId = true } = options;
  const number = (forceCallerId ? HK_CALLER_ID_PREFIX : "") + HK_DNC_HOTLINE;
  const keys = getIvrKeys(register, language);

  if (platform === "android") {
    const parts = keys.map((k, i) => ",".repeat(i === 0 ? PAUSES.beforeFirstKey : PAUSES.betweenKeys) + k.key);
    return {
      platform,
      dial: `tel:${encodeTelSegment(number + parts.join(""))}`,
      manualKeys: [],
      autoKeys: true,
      verified: IVR_VERIFIED,
    };
  }

  // iOS (and desktop / unknown): bare number; the user presses the keys while the page shows them.
  return {
    platform,
    dial: `tel:${encodeTelSegment(number)}`,
    manualKeys: keys,
    autoKeys: false,
    verified: IVR_VERIFIED,
  };
}
