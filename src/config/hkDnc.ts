// Hong Kong Do-not-call (DNC) registration: single source of truth for the dial string and IVR key
// sequences (MPC-7450). The landing page (MPC-7446) and the day-10 email (MPC-7448) read from here only.
//
// !! IVR_VERIFIED = false !!  The hotline, the 1357 caller-ID prefix and the 10-working-day rule come from the
// OFCA public FAQ. The IVR menu itself (which key picks the language, which key picks the register, which key
// confirms) has NOT been confirmed by a real call. Every key below is an UNVERIFIED PLACEHOLDER until MPC-7445
// records the real menu (docs/hk-dnc-ivr-procedure.md). While IVR_VERIFIED is false the page must stay noindex,
// unlinked and without paid traffic, and must not claim that the keys auto-send correctly.
//
// OFCA cannot register on the user's behalf: the call has to come from the number being registered, so the
// "engine" only builds the tap-to-dial string and the on-screen script.

export const HK_DNC_HOTLINE = "1835000";
/** Dial before the hotline when outgoing caller ID is withheld; harmless when it is already shown. */
export const HK_CALLER_ID_PREFIX = "1357";

/** Flip to true ONLY after MPC-7445 has recorded the real IVR menu in docs/hk-dnc-ivr-procedure.md. */
export const IVR_VERIFIED = false;

export type HkRegister = "sms" | "prerecorded" | "fax" | "all";
export type HkLanguage = "en" | "yue";
export type HkPlatform = "android" | "ios" | "other";

export interface IvrKey {
  /** DTMF character: 0-9, * or #. */
  key: string;
  /** What the key is for, shown on screen (iOS / desktop) as the manual script. */
  purpose: "language" | "register" | "confirm";
  /** Every key is UNVERIFIED until MPC-7445. */
  status: "UNVERIFIED";
}

export const HK_REGISTERS: readonly HkRegister[] = ["sms", "prerecorded", "fax", "all"];

// UNVERIFIED placeholders (MPC-7445): menu language option for English / Cantonese.
export const LANGUAGE_KEYS: Record<HkLanguage, IvrKey> = {
  en: { key: "1", purpose: "language", status: "UNVERIFIED" },
  yue: { key: "2", purpose: "language", status: "UNVERIFIED" },
};

// UNVERIFIED placeholders (MPC-7445): register menu option and confirmation key, per register.
const REGISTER_KEYS: Record<HkRegister, readonly IvrKey[]> = {
  sms: [
    { key: "1", purpose: "register", status: "UNVERIFIED" },
    { key: "1", purpose: "confirm", status: "UNVERIFIED" },
  ],
  prerecorded: [
    { key: "2", purpose: "register", status: "UNVERIFIED" },
    { key: "1", purpose: "confirm", status: "UNVERIFIED" },
  ],
  fax: [
    { key: "3", purpose: "register", status: "UNVERIFIED" },
    { key: "1", purpose: "confirm", status: "UNVERIFIED" },
  ],
  all: [
    { key: "4", purpose: "register", status: "UNVERIFIED" },
    { key: "1", purpose: "confirm", status: "UNVERIFIED" },
  ],
};

/**
 * Android dialers treat "," as a ~2 second pause. UNVERIFIED: the real IVR greeting length is unknown until
 * MPC-7445, so these are deliberately generous.
 */
export const PAUSES = {
  /** Wait for the IVR greeting before the first key. */
  beforeFirstKey: 4,
  /** Wait for each following prompt. */
  betweenKeys: 3,
} as const;

/** The ordered keys to press for a language and register. */
export function getIvrKeys(register: HkRegister, language: HkLanguage = "en"): IvrKey[] {
  return [LANGUAGE_KEYS[language], ...REGISTER_KEYS[register]];
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
