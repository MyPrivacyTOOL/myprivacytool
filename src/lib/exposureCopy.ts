// CK-7799 steps 3 and 4: teaser line and one-sentence explainers for the six most interesting hexagons.
// DRAFT for owner sign-off; not live until the real-people card sort result is recorded (see the task).
// Wording rule: only say what the detector actually does. No numbers about how many people share a value.
import { HEXAGON_INTEREST_ORDER } from './hexagonInterestOrder';

export const TOP_SIX_IDS = HEXAGON_INTEREST_ORDER.slice(0, 6);

export const TOP_SIX_EXPLAINERS: Readonly<Record<string, string>> = {
  'webrtc-leak': 'Some browsers can show a site your real network address, even when you use a VPN.',
  'canvas-fingerprint': 'Your browser draws a hidden image in a way that can help a site recognise your device.',
  'dns-leak': 'Your DNS requests can show which network is looking up a site.',
  'typing-patterns': 'The rhythm of how you type can be measured by a page.',
  'webgl-fingerprint': 'Your graphics hardware can be read and used as part of a device signature.',
  'audio-fingerprint': 'Tiny differences in how your device processes sound can add to a device signature.',
};

/** Teaser: names up to 3 of the top six that were found, then the real count of the rest. */
export function buildTeaser(foundIds: readonly string[], labels: Readonly<Record<string, string>>): string {
  const named = TOP_SIX_IDS.filter(id => foundIds.includes(id)).slice(0, 3);
  if (named.length === 0) return `We found ${foundIds.length} things your browser tells every site.`;
  const rest = foundIds.length - named.length;
  const names = named.map(id => labels[id] ?? id);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `We found your ${list}, plus ${rest} more thing${rest === 1 ? '' : 's'}.`;
}
