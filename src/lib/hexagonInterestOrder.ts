// CK-7799: order in which the scan reveals hexagons, most interesting first.
// Source: Exposure card rating E1 + E2 (21 AI personas, 54 hexagons). A combined score of
// care (60%) and "impressed a tool can find this" (40%). These are hypotheses from AI personas,
// not measurements of real visitors; re-test with real people and replace this list if they disagree.
// Results page: https://app.notion.com/p/3f828547eaa781b1b0bdc6fcb376c922
// Ids are registry ids (shared/hexagon-registry/registry.js). An id missing from the scan is skipped;
// an id missing from this list is revealed after the listed ones, in the previous category order.
export const HEXAGON_INTEREST_ORDER: readonly string[] = [
  'webrtc-leak', 'canvas-fingerprint', 'dns-leak', 'typing-patterns', 'webgl-fingerprint',
  'audio-fingerprint', 'font-detection', 'battery-fingerprint', 'language-mismatch', 'screen-fingerprint',
  'location', 'mouse-tracking', 'battery', 'social-platforms', 'meta-services',
  'google-services', 'microsoft-services', 'click-patterns', 'cross-site-identity', 'hardware-profile',
  'isp', 'engagement-map', 'session-duration', 'scroll-behavior', 'cookies-status',
  'media-devices', 'fingerprint-protection', 'demographic', 'user-profile', 'indexeddb-status',
  'localstorage-status', 'rotation-angle', 'tilt-gamma', 'tilt-beta', 'connection',
  'extension-detection', 'referrer', 'sessionstorage-status', 'motion-sensors', 'mixed-content',
  'cache-status', 'privacy', 'tls-config', 'security-headers', 'timezone-locale',
  'screen', 'orientation', 'language-fallbacks', 'device', 'browser-security',
  'time', 'browser', 'https-status', 'primary-language',
];

const RANK = new Map(HEXAGON_INTEREST_ORDER.map((id, i) => [id, i] as const));

/** Rank for sorting; ids not on the list sort after every listed id. */
export const interestRank = (id: string): number => RANK.get(id) ?? HEXAGON_INTEREST_ORDER.length;
