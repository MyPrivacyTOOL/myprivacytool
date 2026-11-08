// The web-scan groups laid out for the climbing footprint trail (design: Notion, MPC-9546 strategy page). Order is bottom to top, left to right,
// and tells a story inside each group; it is a PROPOSAL for Chris and differs from the live page where linked tiles were moved together.
// Every group uses the registry's own members (pathTrailGroups.test.ts fails if a tile is missing or invented).
import type { TileState } from '@/lib/footprintTrail';

export interface TrailGroup {
  /** Registry group name (HEXAGON_GROUPS). */
  group: string;
  /** Tiles per row, bottom row first. */
  rows: number[];
  /** Hexagon ids, bottom to top and left to right. */
  order: string[];
  /** Sample states that differ from "we hold it", to show the no-data rules. */
  sample?: Record<string, TileState>;
  /** One line: why the tiles sit in this order. */
  story: string;
}

export const TRAIL_GROUPS: TrailGroup[] = [
  {
    group: 'Device & Network',
    rows: [2, 3, 2, 3, 2],
    order: ['referrer', 'time', 'location', 'isp', 'connection', 'device', 'browser', 'screen', 'battery', 'privacy', 'demographic', 'user-profile'],
    story: 'How you arrived, then where and on what network, then what device, then what can be guessed about you.',
  },
  {
    group: 'Language Intelligence',
    rows: [2, 1],
    order: ['primary-language', 'language-fallbacks', 'language-mismatch'],
    story: 'The language you use, the ones you fall back to, and whether they disagree.',
  },
  {
    group: 'Device Orientation',
    rows: [2, 3],
    order: ['orientation', 'rotation-angle', 'tilt-beta', 'tilt-gamma', 'motion-sensors'],
    sample: { 'motion-sensors': 'cant' },
    story: 'How the device is held, how it turns, how it tilts, then whether sensors report it (a desktop cannot).',
  },
  {
    group: 'Social Accounts',
    rows: [2, 3],
    order: ['google-services', 'meta-services', 'microsoft-services', 'social-platforms', 'cross-site-identity'],
    story: 'The big accounts first, then how many platforms, then whether one identity links them.',
  },
  {
    group: 'Storage Analysis',
    rows: [2, 3],
    order: ['cookies-status', 'localstorage-status', 'sessionstorage-status', 'indexeddb-status', 'cache-status'],
    sample: { 'cache-status': 'clear' },
    story: 'From the smallest stores to the largest, ending on the cache.',
  },
  {
    group: 'Security Status',
    rows: [2, 3, 1],
    order: ['https-status', 'tls-config', 'security-headers', 'mixed-content', 'browser-security', 'dns-leak'],
    sample: { 'mixed-content': 'clear' },
    story: 'The connection, its encryption, the site rules, then the browser, ending on where lookups go.',
  },
  {
    group: 'Behavior Tracking',
    rows: [2, 3, 1],
    order: ['mouse-tracking', 'click-patterns', 'scroll-behavior', 'typing-patterns', 'session-duration', 'engagement-map'],
    story: 'Pointer and clicks, then scrolling and typing, ending on how long you stayed and where you looked.',
  },
];
