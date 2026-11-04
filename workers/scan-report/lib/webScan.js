// MPC-7465 (report email B2): a web scan is saved under a random scan number (personal data: the results hold browser-reported values such as IP addresses) and linked to a contact.
// MPC-7470 (decision D12): a scan is saved ONLY when the visitor gives an email address at the contact step AND ticks the separate
// "save my scan result" box. The site then sends the scan together with save_consent:true in the same POST /api/scan; there is no
// save-at-completion endpoint any more. The consent record (time + wording version) is stored on the contact link.
// Everything in a scan comes from the visitor's browser, so it is untrusted text: strict shape, short strings, no control
// characters, never logged. Values are stored as given (escaped later, when anything renders them).
// Switch: WEB_SCAN_SAVE_ENABLED must be exactly "true" (wrangler.toml: "true" since 2026-10-12, MPC-7470; "false" is the rollback).

// Wording versions of the tick-box label the visitor saw. The site sends the version with the request; an unknown version
// (for example a stale cached page with different wording) is rejected, so every stored consent record names text we can show.
// Add a new entry here whenever the label in src/lib/saveConsent.ts changes.
export const SAVE_CONSENT_VERSIONS = ['2026-10-12-v1'];
// MPC-7494: versions of the SEPARATE "Recognise this device" tick box wording (src/lib/saveConsent.ts, RECOGNISE_CONSENT_LABEL). The Worker rejects a version it does not know.
export const RECOGNISE_CONSENT_VERSIONS = ['2026-10-12-v1'];

export const MAX_WEB_SCAN_BYTES = 64 * 1024;
export const MAX_HEXAGONS = 100;
export const MAX_SCAN_MS = 10 * 60 * 1000;           // MPC-7493
export const MAX_RESULTS_SECONDS = 3600;               // MPC-7493
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SCAN_NUMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Allowed keys per hexagon and how each is checked. Anything else in a hexagon rejects the whole scan.
const FIELDS = {
  id: (v) => typeof v === 'string' && ID_RE.test(v),
  label: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 120,
  value: (v) => typeof v === 'string' && v.length <= 1000,
  icon: (v) => typeof v === 'string' && v.length <= 64,
  confidence: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100,
  risk: (v) => typeof v === 'string' && v.length <= 32,
  confirmed: (v) => typeof v === 'boolean',
  category: (v) => typeof v === 'string' && v.length <= 32,
  status: (v) => v === 'found' || v === 'clear' || v === 'not_checked',   // MPC-7487: set by the site at capture; the report re-checks it against the registry
  estimate: (v) => typeof v === 'boolean',
};
const REQUIRED = ['id', 'label', 'value'];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const webScanEnabled = (env) => env.WEB_SCAN_SAVE_ENABLED === 'true';
// MPC-7471-F3: a per-submit key from the popup, so a retry of the SAME submit is recognised. Needs scans.request_id (migration 20261026200000, not applied until Chris approves it);
// REPORT_REQUEST_ID_ENABLED must be exactly "true" for the Worker to read or write that column. Absent = {none:true}; present but not a UUID v4 = refused.
export const requestIdEnabled = (env) => env.REPORT_REQUEST_ID_ENABLED === 'true';
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseRequestId(b) {
  if (!('request_id' in b)) return { none: true };
  if (typeof b.request_id !== 'string' || !REQUEST_ID_RE.test(b.request_id)) return { error: 'Invalid request' };
  return { requestId: b.request_id.toLowerCase() };
}
export const isScanNumber = (v) => typeof v === 'string' && SCAN_NUMBER_RE.test(v);

// Returns { hexagons } or { error } for the list of hexagons. Never echoes the offending value back.
export function validateHexagons(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_HEXAGONS) return { error: 'Invalid hexagons' };
  const seen = new Set();
  const hexagons = [];
  for (const h of list) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return { error: 'Invalid hexagons' };
    const keys = Object.keys(h);
    if (REQUIRED.some((k) => !(k in h))) return { error: 'Invalid hexagons' };
    const out = {};
    for (const k of keys) {
      const ok = FIELDS[k];
      if (!ok || !ok(h[k])) return { error: 'Invalid hexagons' };
      if (typeof h[k] === 'string' && CONTROL.test(h[k])) return { error: 'Invalid hexagons' };
      out[k] = h[k];
    }
    if (seen.has(out.id)) return { error: 'Invalid hexagons' };
    seen.add(out.id);
    hexagons.push(out);
  }
  return { hexagons };
}

// The save part of a POST /api/scan body. Returns { none: true } when the body asks for no save (the usual case: a visitor
// who arrived without a scan), { error } when it asks for one wrongly, or { hexagons, version }.
// A request that carries a scan but not save_consent === true is REJECTED, never saved (and never silently dropped).
export function parseSaveRequest(b) {
  if (!['scan', 'save_consent', 'save_consent_version', 'started_ms', 'previous_scan_number', 'recognise_consent', 'recognise_consent_version'].some((k) => k in b)) return { none: true };
  if (b.save_consent !== true) return { error: 'Save consent required' };
  if (typeof b.save_consent_version !== 'string' || !SAVE_CONSENT_VERSIONS.includes(b.save_consent_version)) return { error: 'Unknown consent wording' };
  // MPC-7494: the separate consent to be recognised. Valid ONLY together with save_consent === true and a scan; recognise_consent must be exactly true
  // (anything else, including false, is refused rather than guessed) and its version known. Otherwise nothing is stored or sent.
  let recogniseVersion;
  if ('recognise_consent' in b || 'recognise_consent_version' in b) {
    if (b.recognise_consent !== true) return { error: 'Invalid request' };
    if (typeof b.recognise_consent_version !== 'string' || !RECOGNISE_CONSENT_VERSIONS.includes(b.recognise_consent_version)) return { error: 'Unknown consent wording' };
    recogniseVersion = b.recognise_consent_version;
  }
  const v = validateHexagons(b.scan);
  if (v.error) return v;
  if (new TextEncoder().encode(JSON.stringify(v.hexagons)).length > MAX_WEB_SCAN_BYTES) return { error: 'Invalid hexagons' };   // matches the web_scans.results_bytes check
  // MPC-7493: how long the scan took and the scan number this browser already held (a return visit). Optional, and valid only together with a scan that is being saved.
  if (b.started_ms !== undefined && !(Number.isInteger(b.started_ms) && b.started_ms >= 0 && b.started_ms <= MAX_SCAN_MS)) return { error: 'Invalid request' };
  if (b.previous_scan_number !== undefined && !isScanNumber(b.previous_scan_number)) return { error: 'Invalid request' };
  return { hexagons: v.hexagons, version: b.save_consent_version, recogniseVersion, startedMs: b.started_ms, previousScanNumber: b.previous_scan_number?.toLowerCase() };
}

// Reads the body with a hard size cap (content-length can be missing or wrong), then parses it.
export async function readCappedJson(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) return { status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max) return { status: 413 };
  try { return { body: JSON.parse(text) }; } catch { return { status: 400 }; }
}

export async function saveWebScan(sb, hexagons, { startedMs, previousScanNumber } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(hexagons)).length;
  const row = await sb.insert('web_scans', { source: 'web', hexagon_count: hexagons.length, results: hexagons, results_bytes: bytes });
  // MPC-7493: the first funnel steps and the return link. Best effort: a failure here never costs the visitor their scan number.
  const now = Date.now();
  await recordEvent(sb, row.id, 'scan_finished', { at: now });
  if (startedMs !== undefined) await recordEvent(sb, row.id, 'scan_started', { at: now - startedMs });
  if (previousScanNumber && previousScanNumber !== row.id) {
    try { await sb.insert('web_scan_returns', { web_scan_id: row.id, previous_scan_id: previousScanNumber }); }
    catch (e) { if (e.status !== 409) console.error('web scan return link failed:', e.status || 'error'); }   // 409: the earlier scan was deleted or never existed
  }
  return row.id;
}

// MPC-7493: funnel steps. The site may report these three; scan_started/scan_finished are set when the scan is saved and contact_given when the contact is linked.
// Under D12 (MPC-7470) a scan exists only after the contact step, so these numbers cover ONLY visitors who gave a contact and ticked the box;
// drop-off before the contact step comes from the GA4 events (scan_started, privacy_scan_completed, funnel_step, report_requested).
export const CLIENT_STEPS = ['results_viewed', 'contact_step_opened', 'results_time'];

// Stores the first time a step happened for a saved scan (results_time keeps the longest time). Never throws; returns true when stored.
export async function recordEvent(sb, scanNumber, step, { at = Date.now(), seconds } = {}) {
  try {
    const row = { web_scan_id: scanNumber, step, occurred_at: new Date(at).toISOString() };
    if (step === 'results_time') {
      const s = Math.min(MAX_RESULTS_SECONDS, Math.max(0, Math.round(Number(seconds))));
      if (!Number.isFinite(s)) return false;
      row.seconds = s;
    }
    await sb.insert('web_scan_events', row);
    return true;
  } catch (e) {
    if (e.status === 409 && step === 'results_time' && String(e.message).includes('23505')) {
      try { await sb.patch(`web_scan_events?web_scan_id=eq.${scanNumber}&step=eq.results_time&seconds=lt.${Math.round(seconds)}`, { seconds: Math.min(MAX_RESULTS_SECONDS, Math.round(seconds)) }); } catch { /* keep the earlier value */ }
      return true;
    }
    if (e.status !== 409) console.error('web scan step failed:', step, e.status || 'error');   // 409: already recorded, or the scan number is unknown
    return false;
  }
}

// Validates a step reported by the site: {scan_number, step, seconds?}. Returns {scanNumber, step, seconds} or {error}.
export function validateStep(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request' };
  for (const k of Object.keys(body)) if (!['scan_number', 'step', 'seconds'].includes(k)) return { error: 'Invalid request' };
  if (!isScanNumber(body.scan_number) || !CLIENT_STEPS.includes(body.step)) return { error: 'Invalid request' };
  if (body.step === 'results_time') {
    if (!(typeof body.seconds === 'number' && Number.isFinite(body.seconds) && body.seconds >= 0)) return { error: 'Invalid request' };
  } else if (body.seconds !== undefined) return { error: 'Invalid request' };
  return { scanNumber: body.scan_number.toLowerCase(), step: body.step, seconds: body.seconds };
}

// Saves the scan and links it to the contact in one step, with the consent record (when and which wording) on the link.
// Never throws: a failure must not cost the visitor their report. If the link cannot be written the scan row is removed again,
// so a scan never stays stored without a contact and a consent record. Returns { saved, scanNumber }.
export async function saveWebScanForContact(env, sb, { hexagons, contactId, version, recogniseVersion, startedMs, previousScanNumber, now = new Date() }) {
  if (!webScanEnabled(env) || !contactId || !SAVE_CONSENT_VERSIONS.includes(version)) return { saved: false };
  let scanNumber;
  try {
    scanNumber = await saveWebScan(sb, hexagons, { startedMs, previousScanNumber });
  } catch (e) {
    console.error('web scan save failed:', e.status || 'error');   // status only: the message could carry visitor values
    return { saved: false };
  }
  try {
    await sb.insert('web_scan_contacts', { web_scan_id: scanNumber, channel: 'email', contact_id: contactId, save_consent_at: now.toISOString(), save_consent_version: version,
      // MPC-7494: only when the visitor ticked the separate recognise box (a known wording version); otherwise the link carries no recognition consent.
      ...(RECOGNISE_CONSENT_VERSIONS.includes(recogniseVersion) ? { recognise_consent_at: now.toISOString(), recognise_consent_version: recogniseVersion } : {}) });
    await recordEvent(sb, scanNumber, 'contact_given');   // MPC-7493
    return { saved: true, scanNumber };
  } catch (e) {
    console.error('web scan link failed:', e.status || 'error');
    await sb.remove(`web_scans?id=eq.${scanNumber}`).catch((e2) => console.error('web scan clean-up failed:', e2.status || 'error'));
    return { saved: false };
  }
}
