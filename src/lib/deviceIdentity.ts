/**
 * Confidence-gated device identity.
 *
 * Returns a device only when independent signals AGREE. Anything ambiguous,
 * conflicting or unrecognised is "unknown" — never a guess. The hero carousel
 * is shown only for certain identities; unknown follows the hexagon path.
 */

import type { HexagonData } from './deviceDetection';

export type DeviceCategory =
  | 'iphone'
  | 'ipad'
  | 'android-phone'
  | 'android-tablet'
  | 'mac'
  | 'windows'
  | 'linux'
  | 'chromeos';

export interface DeviceSignals {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  /** navigator.userAgentData, when the browser provides it (Chromium). */
  uaData?: { platform?: string; mobile?: boolean; model?: string } | null;
}

export type DeviceIdentity =
  | {
      certain: true;
      category: DeviceCategory;
      label: string;
      /** Exact model — only when the browser reports it (Chromium client hints). */
      model?: string;
      /** Human-readable "we know because" facts. */
      evidence: string[];
    }
  | { certain: false; reason: string };

/** Every device the hero carousel can land on (unknown is deliberately absent). */
export const CAROUSEL_DEVICES: { category: DeviceCategory; label: string }[] = [
  { category: 'iphone', label: 'iPhone' },
  { category: 'android-phone', label: 'Android phone' },
  { category: 'ipad', label: 'iPad' },
  { category: 'android-tablet', label: 'Android tablet' },
  { category: 'mac', label: 'Mac' },
  { category: 'windows', label: 'Windows PC' },
  { category: 'linux', label: 'Linux PC' },
  { category: 'chromeos', label: 'Chromebook' },
];

const unknown = (reason: string): DeviceIdentity => ({ certain: false, reason });

const touchFact = (n: number) =>
  n === 0 ? 'no touch screen' : `${n} touch point${n === 1 ? '' : 's'}`;

export function identifyDevice(s: DeviceSignals): DeviceIdentity {
  const ua = s.userAgent || '';
  const platform = s.platform || '';
  const screenFact = `${s.screenWidth}×${s.screenHeight} @${s.pixelRatio}x`;
  const claimsMobile = /iPhone|iPad|iPod|Android.*Mobile|Mobile.*Android/i.test(ua);

  // A phone/tablet claim with no touch hardware is emulation or spoofing.
  if (/iPhone|iPad|Android/i.test(ua) && s.maxTouchPoints === 0) {
    return unknown('Mobile user agent without touch hardware');
  }
  // Client hints disagreeing with the UA string means one of them is spoofed.
  if (s.uaData?.platform && s.uaData.mobile !== undefined && claimsMobile !== s.uaData.mobile) {
    return unknown('User agent and client hints disagree');
  }

  if (/iPhone/.test(ua)) {
    return {
      certain: true,
      category: 'iphone',
      label: 'iPhone',
      evidence: ['Apple iOS', touchFact(s.maxTouchPoints), screenFact],
    };
  }

  // iPadOS Safari presents as a Mac; real Macs report ≤1 touch point.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && s.maxTouchPoints > 1)) {
    return {
      certain: true,
      category: 'ipad',
      label: 'iPad',
      evidence: ['Apple iPadOS', touchFact(s.maxTouchPoints), screenFact],
    };
  }

  if (/Android/.test(ua)) {
    const phone = /Mobile/.test(ua);
    const model = s.uaData?.model?.trim() || undefined;
    return {
      certain: true,
      category: phone ? 'android-phone' : 'android-tablet',
      label: model || (phone ? 'Android phone' : 'Android tablet'),
      model,
      evidence: [model ? `Model reported: ${model}` : 'Android', touchFact(s.maxTouchPoints), screenFact],
    };
  }

  if (/CrOS/.test(ua)) {
    return { certain: true, category: 'chromeos', label: 'Chromebook', evidence: ['ChromeOS', screenFact] };
  }

  if (/Macintosh|Mac OS X/.test(ua) && /Mac/i.test(platform || s.uaData?.platform || 'Mac')) {
    return { certain: true, category: 'mac', label: 'Mac', evidence: ['Apple macOS', touchFact(s.maxTouchPoints), screenFact] };
  }

  if (/Windows NT/.test(ua) && /Win/i.test(platform || s.uaData?.platform || 'Win')) {
    return { certain: true, category: 'windows', label: 'Windows PC', evidence: ['Microsoft Windows', screenFact] };
  }

  if (/Linux|X11/.test(ua) && /Linux|X11/i.test(platform || s.uaData?.platform || 'Linux')) {
    return { certain: true, category: 'linux', label: 'Linux PC', evidence: ['Linux', screenFact] };
  }

  return unknown('Signals do not match a known device');
}

/** Read the live signals from the browser. */
export function readDeviceSignals(): DeviceSignals {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean; model?: string };
  };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints || 0,
    screenWidth: screen.width,
    screenHeight: screen.height,
    pixelRatio: window.devicePixelRatio || 1,
    uaData: nav.userAgentData ?? null,
  };
}

/**
 * Chromium hides the model until asked. Resolve it when available so Android
 * phones can be named exactly; returns the signals unchanged elsewhere.
 */
export async function readDeviceSignalsWithModel(): Promise<DeviceSignals> {
  const signals = readDeviceSignals();
  const uaData = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ model?: string }> };
  }).userAgentData;
  try {
    if (uaData?.getHighEntropyValues) {
      const { model } = await uaData.getHighEntropyValues(['model']);
      if (model) signals.uaData = { ...(signals.uaData ?? {}), model };
    }
  } catch {
    /* hints unavailable — fall back to what we have */
  }
  return signals;
}

/**
 * When we cannot be certain of the device, the Device Type hexagon must not
 * present the old regex guess as a 92% fact. Relabel it as a question for the
 * visitor to confirm, with a low confidence. Certain (or not yet known)
 * identities leave the hexagons untouched.
 */
export function hedgeDeviceHexagon(
  hexagons: HexagonData[],
  identity: DeviceIdentity | null,
): HexagonData[] {
  if (!identity || identity.certain) return hexagons;
  return hexagons.map((hex) =>
    hex.id === 'device'
      ? {
          ...hex,
          label: 'Device Type (our guess)',
          value: hex.value.endsWith('?') ? hex.value : `${hex.value}?`,
          confidence: Math.min(hex.confidence, 50),
        }
      : hex,
  );
}
