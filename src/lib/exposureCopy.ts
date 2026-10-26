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

// CK-8313 (CK-7799 step 6): Alice speaks the top three first and keeps the bottom fifteen short.
// DRAFT wording approved by the owner in chat on 2026-10-19; hold the PR until the owner has seen it.
export const ALICE_QUIET_IDS: ReadonlySet<string> = new Set(HEXAGON_INTEREST_ORDER.slice(-15));

export const ALICE_INTRO =
  "Hi, I'm Alice. Let's look at the three things people most often ask about first. Tap any hexagon to see what it means. Tapping also confirms it looks right to you.";

export const ALICE_WEBRTC_LEAK =
  'Your browser let this page see an internet address that may be your real one, even if you use a VPN. This one needs investigation to know who else can see it.';

/** Short line for the bottom fifteen: no claims, no numbers. */
export function aliceQuietLine(label: string, value: string): string {
  return `${label}: ${value}. An ordinary detail every site sees. Ask me if you want more.`;
}

/** Teaser: names up to 3 of the top six that were found, then the real count of the rest. */
export function buildTeaser(foundIds: readonly string[], labels: Readonly<Record<string, string>>): string {
  const named = TOP_SIX_IDS.filter(id => foundIds.includes(id)).slice(0, 3);
  if (named.length === 0) return `We found ${foundIds.length} things your browser tells every site.`;
  const rest = foundIds.length - named.length;
  const names = named.map(id => labels[id] ?? id);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `We found your ${list}, plus ${rest} more thing${rest === 1 ? '' : 's'}.`;
}
