// MPC-7465 (report email B2): save every completed web scan under a random scan number (personal data: the results hold browser-reported values such as IP addresses), then link the contact to it.
// Everything in a scan comes from the visitor's browser, so it is untrusted text: strict shape, short strings, no control
// characters, never logged. Values are stored as given (escaped later, when anything renders them).
// Switch: WEB_SCAN_SAVE_ENABLED must be exactly "true" (wrangler.toml keeps it "false" until MPC-7470 signs off the wording).

export const MAX_WEB_SCAN_BYTES = 64 * 1024;
export const MAX_HEXAGONS = 100;
export const MAX_SCAN_MS = 10 * 60 * 1000;
export const MAX_RESULTS_SECONDS = 3600;
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
export const isScanNumber = (v) => typeof v === 'string' && SCAN_NUMBER_RE.test(v);

// Returns { hexagons } or { error }. Never echoes the offending value back.
export function validateWebScan(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request' };
  for (const k of Object.keys(body)) if (!['consent', 'hexagons', 'started_ms', 'previous_scan_number'].includes(k)) return { error: 'Invalid request' };
  if (body.consent !== true) return { error: 'Consent required' };
  // MPC-7493: how long the scan took (milliseconds, to date the "scan started" step) and the scan number this browser already held (a return visit).
  if (body.started_ms !== undefined && !(Number.isInteger(body.started_ms) && body.started_ms >= 0 && body.started_ms <= MAX_SCAN_MS)) return { error: 'Invalid request' };
  if (body.previous_scan_number !== undefined && !isScanNumber(body.previous_scan_number)) return { error: 'Invalid request' };
  const list = body.hexagons;
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
  return { hexagons, startedMs: body.started_ms, previousScanNumber: body.previous_scan_number?.toLowerCase() };
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

// Links a contact row to a saved scan. Never throws: a bad or unknown scan number must not cost the visitor their report.
export async function linkWebScan(env, sb, scanNumber, channel, contactId) {
  if (!webScanEnabled(env) || !isScanNumber(scanNumber) || !contactId) return { linked: false };
  try {
    await sb.insert('web_scan_contacts', { web_scan_id: scanNumber.toLowerCase(), channel, contact_id: contactId });
    await recordEvent(sb, scanNumber.toLowerCase(), 'contact_given');   // MPC-7493
    return { linked: true };
  } catch (e) {
    // PostgREST answers 409 both for "already linked" (23505) and for an unknown scan number (23503, foreign key).
    if (e.status === 409 && String(e.message).includes('23505')) { await recordEvent(sb, scanNumber.toLowerCase(), 'contact_given'); return { linked: true }; }
    console.error('web scan link failed:', e.status || 'error');
    return { linked: false };
  }
}
