// MPC-7916 Phase 2 + MPC-8733: the fix step for a tile, as a typed "lego block". DRAFT wording: needs Chris's review before it is switched on.
// FIX_STEPS are the four measured findings that can turn red (approved wording). fixStepFor() keeps returning only those, for the
// current next-step card. fixBlockFor() / noActionReason() below cover all 54 registry hexagons (MPC-7914 model, approved in MPC-8733).
import type { TileKind } from './hexagonTile';

export const FIX_COPY_IS_DRAFT = true;

export interface FixStep {
  /** One plain line: what this means for the visitor. */
  why: string;
  /** What to do, in order. */
  steps: string[];
}

const FIX_STEPS: Record<string, FixStep> = {
  'webrtc-leak': {
    why: 'Your browser can reveal your real network address to a website, even when you use a VPN.',
    steps: [
      'Turn off WebRTC address sharing (a browser feature used for video calls) in your browser settings, or add a WebRTC-blocking extension.',
      'Reload this page and look at this hexagon again.',
    ],
  },
  'canvas-fingerprint': {
    why: 'Your browser can draw an image in a way that can be nearly unique to your device, so sites can recognise you without cookies.',
    steps: [
      'Use a browser, or a browser setting, that blocks or randomises canvas fingerprinting (the hidden image test sites use to recognise you).',
      'Reload this page and look at this hexagon again.',
    ],
  },
  'webgl-fingerprint': {
    why: 'Your graphics hardware can give a signature that helps sites recognise your device.',
    steps: [
      'Use a browser, or a browser setting, that hides or randomises graphics details.',
      'Reload this page and look at this hexagon again.',
    ],
  },
  'audio-fingerprint': {
    why: 'Your device can handle sound in a slightly unique way that sites can use to recognise it.',
    steps: [
      'Use a browser, or a browser setting, that protects against audio fingerprinting.',
      'Reload this page and look at this hexagon again.',
    ],
  },
  // Timezone/Locale has no fix step: every browser reports it, so it is "seen" (with the browser-says tick), never red.
};

export function fixStepFor(id: string): FixStep | undefined {
  return FIX_STEPS[id];
}

// ---- MPC-8733: the typed block model (approved by Chris 2026-10-28; table on the approval page under MPC-7914) ----------------
// Every registry hexagon has exactly one entry: a FixBlock (9) or an explicit no_action_needed with a reason (45).
// A test fails the build if a registry id has neither. Wording stays DRAFT until the real-people check (MPC-8732).

export type FixKind = 'self_report' | 'rescan_verifiable' | 'external_link' | 'contact_template';
/** Who may run a block. An agent only ever runs it with the visitor's recorded consent for that block; that consent store is not built. */
export type FixRunner = 'visitor' | 'agent_with_consent';
/** Region variants a block can point at (R1 location, R2 internet provider, R3 profiling opt-out). */
export type RegionKey = 'R1' | 'R2' | 'R3';

export interface FixBlock {
  hexagon_id: string;
  kind: FixKind;
  why: string;
  instruction: string[];
  /** How completion is recorded. A visitor's word is "You told us" (medium green), never solid green. */
  completion: 'you_told_us';
  /** What turns the tile solid green. "none" = cannot re-check from the web: the tile stays "You told us". */
  recheck: 'rescan' | 'none';
  /** Detection change the re-check waits for (D1 WebRTC states, D2 canvas/WebGL/audio, D3 locale mismatch). Until it lands the tile stays "You told us". */
  recheck_needs?: 'D1' | 'D2' | 'D3';
  who_may_run: readonly FixRunner[];
  region?: RegionKey;
  copy_status: 'draft' | 'approved';
}

const VISITOR_NOW: readonly FixRunner[] = ['visitor', 'agent_with_consent'];

const block = (b: Omit<FixBlock, 'completion' | 'who_may_run' | 'copy_status'>): FixBlock => ({
  ...b,
  completion: 'you_told_us',
  who_may_run: VISITOR_NOW,
  copy_status: 'draft',
});

const fromStep = (id: string, recheck_needs: 'D1' | 'D2'): FixBlock =>
  block({ hexagon_id: id, kind: 'rescan_verifiable', why: FIX_STEPS[id].why, instruction: FIX_STEPS[id].steps, recheck: 'rescan', recheck_needs });

const FIX_BLOCKS: Record<string, FixBlock> = {
  'webrtc-leak': fromStep('webrtc-leak', 'D1'),
  'canvas-fingerprint': fromStep('canvas-fingerprint', 'D2'),
  'webgl-fingerprint': fromStep('webgl-fingerprint', 'D2'),
  'audio-fingerprint': fromStep('audio-fingerprint', 'D2'),
  location: block({
    hexagon_id: 'location',
    kind: 'self_report',
    why: 'Websites can place you in a city from your internet address.',
    instruction: [
      'If you would rather they could not, use the region step below to change the network you connect through.',
      'Reload this page and look at this hexagon again.',
    ],
    recheck: 'none',
    region: 'R1',
  }),
  isp: block({
    hexagon_id: 'isp',
    kind: 'contact_template',
    why: 'Websites can see which company provides your internet, and scammers pose as that company.',
    instruction: [
      'Treat any message claiming to be from your provider as suspect until you check it using the number on your bill.',
      'Send your provider the message for your region (below), asking what it holds about you and to stop using it for marketing.',
    ],
    recheck: 'none',
    region: 'R2',
  }),
  'language-mismatch': block({
    hexagon_id: 'language-mismatch',
    kind: 'self_report',
    why: 'Your language setting does not match your time zone, which can hint that you are travelling or using a VPN.',
    instruction: [
      'Set your browser language to match where you are.',
      'Reload this page and look at this hexagon again.',
    ],
    recheck: 'rescan',
    recheck_needs: 'D3',
  }),
  demographic: block({
    hexagon_id: 'demographic',
    kind: 'external_link',
    why: 'We guessed an age group from your device and the time of day. It is only a guess and can be wrong, but advertisers make the same kind of guess.',
    instruction: [
      'Nothing on your device needs changing.',
      'If you do not want to be profiled, use the opt-out for your region (below).',
    ],
    recheck: 'none',
    region: 'R3',
  }),
  'user-profile': block({
    hexagon_id: 'user-profile',
    kind: 'self_report',
    why: 'We labelled you (for example "traveler" or "multilingual") from the languages your browser lists.',
    instruction: [
      'Remove extra languages from your browser\u2019s language list and keep only the one you use.',
      'Reload this page and look at this hexagon again.',
    ],
    recheck: 'none',
  }),
};

/** Hexagons with no fix step, and why. Low-sensitivity and no-claim tiles never turn red, so they cannot show a block. */
const NO_ACTION: Record<string, string> = {
  "device": "Your browser tells every site its device type; hiding it breaks pages. Low risk: grey “seen, minor”, never red.",
  "browser": "Every site is told your browser and version. Low risk. Optional tip (text only): keep your browser updated.",
  "time": "Your device clock is visible to every site by design. Low risk; nothing to change.",
  "screen": "Screen size is shared by millions of devices. Low risk; nothing to change.",
  "privacy": "Do Not Track is a request many sites ignore, and an unsupported browser reads as “not checked”. Low risk. Optional tip (text only): turn it on, knowing many sites ignore it.",
  "connection": "The browser’s own estimate of your connection type. Low risk. Optional tip (text only): avoid sensitive sign-ins on public Wi-Fi.",
  "referrer": "Shows how you arrived. We cannot tell “direct” from “hidden by your settings”. Low risk.",
  "battery": "Battery level, only where the browser offers it. Low risk on its own.",
  "primary-language": "Your main language is sent to every site by design. Low risk.",
  "language-fallbacks": "The extra languages your browser lists. Low risk alone. Removing extras (User Profile step) changes this too.",
  "orientation": "Whether the screen is upright or sideways. Low risk; nothing to change.",
  "rotation-angle": "Screen rotation in degrees. Low risk; nothing to change.",
  "tilt-beta": "Tilt reading, only with a motion sensor and permission. Low risk. Optional tip (text only): say no to motion-sensor permission.",
  "tilt-gamma": "Tilt reading, only with a motion sensor and permission. Low risk. Optional tip (text only): say no to motion-sensor permission.",
  "motion-sensors": "Whether motion sensors are active. Low risk. Optional tip (text only): say no to motion-sensor permission.",
  "font-detection": "The font list is a small fingerprint ingredient; no safe user change (hiding fonts breaks pages). Low risk; the canvas step covers fingerprint protection.",
  "extension-detection": "A heuristic guess about ad-blockers; “none detected” cannot be told from a failed check. Low risk; nothing to fix.",
  "fingerprint-protection": "Reports whether protection was seen; it is not a fault of yours. The WebRTC, canvas, WebGL and audio steps are the fix.",
  "hardware-profile": "CPU core count, shared by every browser. Low risk; nothing to change.",
  "screen-fingerprint": "Display details, low risk alone. Nothing to change.",
  "timezone-locale": "Every browser reports it, and hiding it breaks sites and can itself stand out. Kept as grey “seen” with “Your browser says this”, never red (#409). Counted as one of the original five; it has no fix step in code.",
  "battery-fingerprint": "Battery API reading; overlaps Device Status. Low risk.",
  "media-devices": "A count of cameras and microphones, not their contents. Low risk. Optional tip (text only): block camera and microphone permission for sites you do not use.",
  "cookies-status": "Cookies on this site only. Low risk. Optional tip (text only): clear this site’s data in browser settings; this one can turn solid green on rescan (the registry allows CLEAR).",
  "localstorage-status": "Storage on this site only. Low risk. Optional tip (text only): clear this site’s data; the registry allows CLEAR here.",
  "sessionstorage-status": "Storage on this site only. Low risk. Optional tip (text only): close the tab and rescan; the registry allows CLEAR here.",
  "indexeddb-status": "Our own site’s databases only. Low risk; nothing to change.",
  "cache-status": "Our own site’s service worker and caches only. Low risk; nothing to change.",
  "google-services": "A web page cannot see whether you are signed in to Google (it sees only this site’s cookies), so we make no claim. Pointer: a separate real check you start yourself (sign-in or permission flow, Notion Table 3). Not built.",
  "meta-services": "Same limit as Google Account: no claim. Pointer: a separate real check you start yourself. Not built.",
  "microsoft-services": "Same limit as Google Account: no claim. Pointer: a separate real check you start yourself. Not built.",
  "social-platforms": "Same limit as Google Account: no claim. Pointer: a separate real check you start yourself. Not built.",
  "cross-site-identity": "Cookies set by other sites are not visible here: no claim. Pointer: a separate real check you start yourself. Not built.",
  "dns-leak": "Today this reuses the WebRTC probe and does not test DNS, so we make no claim. Pointer: a real DNS test (Notion Table 3) as its own build. Not built.",
  "https-status": "Describes how this page reached you, not a setting of yours. Low risk.",
  "mixed-content": "Describes our page, not your device. Low risk.",
  "security-headers": "Describes our site, not you; the headers are not read yet. No claim. Pointer: Notion Table 3 detection change.",
  "browser-security": "A guess from hard-coded version thresholds. Low risk. Optional tip (text only): keep your browser updated.",
  "tls-config": "A browser cannot read the TLS version; only plain HTTP is a finding. Low risk.",
  "mouse-tracking": "How you move the mouse on this page, as any site could see. Low risk; nothing on your device to fix.",
  "typing-patterns": "Typing rhythm on this page, as any site could see. Low risk here; nothing on your device to fix.",
  "click-patterns": "Clicks on this page. Low risk; nothing to fix.",
  "scroll-behavior": "Scrolling on this page. Low risk; nothing to fix.",
  "session-duration": "How long you stayed. Low risk; nothing to fix.",
  "engagement-map": "Where on this page you looked or clicked. Low risk; nothing to fix.",
};

export function fixBlockFor(id: string): FixBlock | undefined {
  return FIX_BLOCKS[id];
}

/** The reason a hexagon has no fix step, or undefined if it has a block. */
export function noActionReason(id: string): string | undefined {
  return NO_ACTION[id];
}

export const FIX_BLOCK_IDS: readonly string[] = Object.keys(FIX_BLOCKS);
export const NO_ACTION_IDS: readonly string[] = Object.keys(NO_ACTION);

/**
 * Render guard, "fix" action: a block shows only on a red tile, or on a purple guess the visitor answered yes to (or their device agreed with).
 * Never on grey, and never for a tile we could not check.
 */
export function canShowFix(id: string, tileKind: TileKind): boolean {
  if (!FIX_BLOCKS[id]) return false;
  return tileKind === 'needs_fixing' || tileKind === 'you_confirmed' || tileKind === 'device_agrees';
}

// ---- Region: chosen ONLY by the jurisdiction the visitor declares. Never from a phone country code or an internet address. --------
export type Jurisdiction = 'eu_eea' | 'uk' | 'us_california' | 'us_other' | 'hong_kong' | 'australia' | 'other';
export const JURISDICTIONS: readonly Jurisdiction[] = ['eu_eea', 'uk', 'us_california', 'us_other', 'hong_kong', 'australia', 'other'];

// DRAFT: a person must read these before they ship (MPC-8736). Until then every region could fall back to `other`.
const REGION_TEXT: Record<RegionKey, Record<Jurisdiction, string>> = {
  R1: {
    eu_eea: 'Connect through a VPN or privacy relay you trust, or switch to mobile data.',
    uk: 'Connect through a VPN or privacy relay you trust, or switch to mobile data.',
    us_california: 'Connect through a VPN or privacy relay you trust, or switch to mobile data.',
    us_other: 'Connect through a VPN or privacy relay you trust, or switch to mobile data.',
    hong_kong: 'Connect through a VPN or privacy relay you trust, or switch to mobile data.',
    australia: 'Connect through a VPN or privacy relay you trust, or switch to mobile data.',
    // Some places restrict VPN use, so the generic text offers no VPN.
    other: 'Switch to mobile data or a different network you trust.',
  },
  R2: {
    eu_eea: 'Ask your provider for a copy of the personal data it holds on you (your right of access) and to stop using it for marketing (your right to object).',
    uk: 'Ask your provider for a copy of the personal data it holds on you (your right of access) and to stop using it for marketing (your right to object).',
    us_california: 'Ask your provider what it holds about you and to stop selling or sharing it (your rights under CCPA/CPRA).',
    us_other: 'Use your provider\u2019s privacy request form. Your rights depend on your state.',
    hong_kong: 'Ask your provider for a copy of your data (a data access request) and to stop using it for direct marketing (PDPO).',
    australia: 'Ask your provider for access to your information and to stop direct marketing (Privacy Act).',
    other: 'Ask your provider\u2019s privacy team what it holds about you and to stop using it for marketing.',
  },
  R3: {
    eu_eea: 'Object to profiling for marketing with the companies that profile you.',
    uk: 'Object to profiling for marketing with the companies that profile you.',
    us_california: 'Opt out of sale or sharing, and turn on a Global Privacy Control signal in your browser.',
    us_other: 'Turn on a Global Privacy Control signal in your browser and use your state\u2019s opt-out.',
    hong_kong: 'Opt out of direct marketing (PDPO) with the companies that contact you.',
    australia: 'Opt out of direct marketing (Privacy Act) with the companies that contact you.',
    other: 'Use the ad-personalisation opt-outs in your browser and accounts.',
  },
};

/** The region text for a block. `declared` is the jurisdiction the visitor chose; undeclared or unknown gets the generic text. */
export function regionTextFor(region: RegionKey, declared?: Jurisdiction | null): string {
  const j = declared && (JURISDICTIONS as readonly string[]).includes(declared) ? declared : 'other';
  return REGION_TEXT[region][j];
}
