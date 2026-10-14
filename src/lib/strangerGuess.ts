// CK-7805: "What a stranger could guess about you". Tier A only: uses signals the scan already has.
// Rules (owner brief, OSINT structure v1): guess, never claim; every finding cites its evidence; no percentages;
// nothing is collected, stored or sent. The "weak" VPN signal (a local address and no public address) is only
// ever used to LOWER confidence, never presented as a fact.
import type { DeviceData, HexagonData } from './deviceDetection';

export type Band = 'likely' | 'possible' | 'long-shot';

export interface Finding {
  id: string;
  claim: string;
  evidence: string[];
  tier: 'A';
  method: 'rule';
  band: Band;
  action: string;
}

export const MAX_FINDINGS = 3;

const IN_APP: Array<[RegExp, string]> = [
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'],
  [/Instagram/i, 'Instagram'],
  [/musical_ly|TikTok|BytedanceWebview/i, 'TikTok'],
  [/MicroMessenger/i, 'WeChat'],
  [/\bLine\//i, 'LINE'],
  [/Snapchat/i, 'Snapchat'],
];

export const detectInAppBrowser = (userAgent: string): string | null => {
  for (const [re, name] of IN_APP) if (re.test(userAgent || '')) return name;
  return null;
};

const hexValue = (hexagons: HexagonData[], id: string): string =>
  hexagons.find((h) => h.id === id)?.value ?? '';

// Browsers freeze or round the OS version in the user agent (Chrome always says macOS 10.15.7), so name the system only.
const osName = (os: string): string => os.replace(/\s*v?\d+([._]\d+)*$/, '').trim() || os;

const deviceWord = (t: string): string => (t === 'Mobile' ? 'phone' : t === 'Tablet' ? 'tablet' : 'computer');

export function generateFindings(input: {
  deviceData?: DeviceData;
  hexagons: HexagonData[];
  userAgent: string;
}): Finding[] {
  const { deviceData, hexagons, userAgent } = input;
  const out: Finding[] = [];

  const app = detectInAppBrowser(userAgent);
  if (app) {
    out.push({
      id: 'in-app-browser',
      claim: `You probably arrived from inside ${app}.`,
      evidence: [`Your browser identifies itself as the ${app} built-in browser.`],
      tier: 'A', method: 'rule', band: 'likely',
      action: 'Open this page in your normal browser if you would rather keep that app out of it.',
    });
  }

  const city = deviceData?.location?.city;
  if (deviceData && city && city !== 'Unknown') {
    const vpnSigns = /^VPN Protected/i.test(hexValue(hexagons, 'webrtc-leak')) || /^VPN Protected/i.test(hexValue(hexagons, 'dns-leak'));
    const band: Band = vpnSigns ? 'long-shot' : deviceData.language?.hasLocationMismatch ? 'possible' : 'likely';
    const evidence = [`Your internet address maps to ${city}${deviceData.location.region ? `, ${deviceData.location.region}` : ''}.`];
    if (vpnSigns) evidence.push('Your connection looks like it may be using a VPN, so this place may not be where you are.');
    else if (deviceData.language?.hasLocationMismatch) evidence.push('Your language settings point somewhere else, so this is less certain.');
    out.push({
      id: 'region',
      claim: `You are probably in or near ${city}.`,
      evidence, tier: 'A', method: 'rule', band,
      action: 'A VPN or a browser privacy setting changes what a stranger sees here.',
    });
  }

  const mismatch = deviceData?.language;
  if (mismatch?.hasLocationMismatch && mismatch.mismatchDetails) {
    out.push({
      id: 'language-mismatch',
      claim: 'You may have a connection to another country or language than where you are.',
      evidence: [mismatch.mismatchDetails],
      tier: 'A', method: 'rule', band: 'possible',
      action: 'This is only a hint from your settings; you can change your browser language any time.',
    });
  }

  if (deviceData?.device?.type && deviceData.device.os) {
    out.push({
      id: 'device-class',
      claim: `You are probably on a ${deviceWord(deviceData.device.type)} running ${osName(deviceData.device.os)}.`,
      evidence: [`Your browser reports a ${deviceWord(deviceData.device.type)} and ${osName(deviceData.device.os)}.`],
      tier: 'A', method: 'rule', band: 'likely',
      action: 'Keeping your system up to date makes this a weaker clue.',
    });
  }

  return out.slice(0, MAX_FINDINGS);
}
