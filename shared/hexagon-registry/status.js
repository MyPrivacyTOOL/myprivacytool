// MPC-7487: the status of one hexagon at scan time, decided where the value is captured.
// FOUND = the detector positively returned a real value. CHECKED_AND_CLEAR = only where the registry allows it and the detector
// positively reported nothing. NOT_CHECKED = failed, blocked, timed out, unsupported, or a placeholder / default value.
// Plain ESM with no dependencies, imported by the website (src/lib/webScan.ts) and by the Worker tests. The rules mirror the
// `status` blocks in registry.js (and the Notion registry page); they do not change what the scan detects.
import { getHexagon } from './registry.js';

export const CAPTURE_STATUS = { FOUND: 'found', CLEAR: 'clear', NOT_CHECKED: 'not_checked' };
const { FOUND, CLEAR, NOT_CHECKED } = CAPTURE_STATUS;

// Placeholder, default and failure values the detectors show when nothing real was returned. Matched on the whole value, case-insensitive.
const PLACEHOLDERS = new Set([
  '', 'location detected', 'unknown', 'unknown isp', 'n/a', 'na', 'null', 'undefined', 'not available',
  'checking...', 'check failed', 'collecting...', 'collecting data...', 'building...',
  'no input yet', 'no clicks yet', 'no scrolling yet', 'permission required', 'no devices', 'blocked', 'api blocked', 'inactive',
]);

// Values that are real but only say "nothing seen", which the code cannot tell from a failed check (the registry flags these hexagons
// as unable to separate clear from not checked): NOT CHECKED, never CLEAR.
const NOTHING_SEEN = {
  'extension-detection': /^none detected$/i,
  'fingerprint-protection': /^none detected$/i,
  'webrtc-leak': /^(no leak detected|blocked)$/i,
  'cache-status': /^not active$/i,
  'indexeddb-status': /^not used$/i,
  'browser-security': /^up to date$/i,
  privacy: /^dnt enabled$/i,
  'webgl-fingerprint': /^detected$/i,
  'font-detection': /^0 fonts$/i,
  'audio-fingerprint': /^0+(\.\.\.)?$/, // CK-8321: a silent or blocked audio read hashes to all zeros; never a finding
};

// The wording where the registry allows CHECKED AND CLEAR, and the positive "nothing found" value the detector gives.
const CLEAR_VALUES = {
  'cookies-status': /^(empty|disabled)$/i,
  'localstorage-status': /^empty$/i,
  'sessionstorage-status': /^empty$/i,
  'https-status': /^secure \(https\)/i,
  'mixed-content': /^none$/i,
};

const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/**
 * @param {string} id        hexagon id (registry id)
 * @param {string} value     the value the detector produced
 * @param {{ connectionIsMeasured?: boolean, browserKnown?: boolean }} [ctx]
 *        connectionIsMeasured: the Network Information API reported the connection (the "WiFi" shown otherwise is an assumed default)
 *        browserKnown: the user agent was recognised (an unknown browser shows "Outdated" for lack of data)
 * @returns {'found'|'clear'|'not_checked'}
 */
export function captureStatus(id, value, ctx = {}) {
  const reg = getHexagon(id);
  if (!reg) return NOT_CHECKED;                                  // not a registry hexagon: never claim anything
  if (reg.truth.level === 'cannot_be_checked') return NOT_CHECKED; // the 7 the site cannot check: whatever the detector returned
  const v = clean(value);
  if (PLACEHOLDERS.has(v.toLowerCase()) || /^unknown\b/i.test(v)) return NOT_CHECKED;
  if (id === 'connection' && v.toLowerCase() === 'wifi' && ctx.connectionIsMeasured === false) return NOT_CHECKED; // assumed default
  if (id === 'browser-security' && ctx.browserKnown === false) return NOT_CHECKED;
  if (id === 'tls-config' && !/no encryption/i.test(v)) return NOT_CHECKED; // the version is never measured; only plain HTTP is a finding
  if (NOTHING_SEEN[id]?.test(v)) return NOT_CHECKED;
  if (reg.status.allowed.includes('CHECKED_AND_CLEAR') && CLEAR_VALUES[id]?.test(v)) return CLEAR;
  return FOUND;
}

/** True when the registry labels this hexagon's value an estimate (shown as "our estimate, not measured"). */
export const isEstimate = (id) => getHexagon(id)?.truth.level === 'estimated';
