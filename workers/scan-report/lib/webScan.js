// MPC-7465 (report email B2): save every completed web scan under a random scan number (personal data: the results hold browser-reported values such as IP addresses), then link the contact to it.
// Everything in a scan comes from the visitor's browser, so it is untrusted text: strict shape, short strings, no control
// characters, never logged. Values are stored as given (escaped later, when anything renders them).
// Switch: WEB_SCAN_SAVE_ENABLED must be exactly "true" (wrangler.toml keeps it "false" until MPC-7470 signs off the wording).

export const MAX_WEB_SCAN_BYTES = 64 * 1024;
export const MAX_HEXAGONS = 100;
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
};
const REQUIRED = ['id', 'label', 'value'];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const webScanEnabled = (env) => env.WEB_SCAN_SAVE_ENABLED === 'true';
export const isScanNumber = (v) => typeof v === 'string' && SCAN_NUMBER_RE.test(v);

// Returns { hexagons } or { error }. Never echoes the offending value back.
export function validateWebScan(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request' };
  for (const k of Object.keys(body)) if (!['consent', 'hexagons'].includes(k)) return { error: 'Invalid request' };
  if (body.consent !== true) return { error: 'Consent required' };
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
  return { hexagons };
}

// Reads the body with a hard size cap (content-length can be missing or wrong), then parses it.
export async function readCappedJson(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) return { status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max) return { status: 413 };
  try { return { body: JSON.parse(text) }; } catch { return { status: 400 }; }
}

export async function saveWebScan(sb, hexagons) {
  const bytes = new TextEncoder().encode(JSON.stringify(hexagons)).length;
  const row = await sb.insert('web_scans', { source: 'web', hexagon_count: hexagons.length, results: hexagons, results_bytes: bytes });
  return row.id;
}

// Links a contact row to a saved scan. Never throws: a bad or unknown scan number must not cost the visitor their report.
export async function linkWebScan(env, sb, scanNumber, channel, contactId) {
  if (!webScanEnabled(env) || !isScanNumber(scanNumber) || !contactId) return { linked: false };
  try {
    await sb.insert('web_scan_contacts', { web_scan_id: scanNumber.toLowerCase(), channel, contact_id: contactId });
    return { linked: true };
  } catch (e) {
    // PostgREST answers 409 both for "already linked" (23505) and for an unknown scan number (23503, foreign key).
    if (e.status === 409 && String(e.message).includes('23505')) return { linked: true };
    console.error('web scan link failed:', e.status || 'error');
    return { linked: false };
  }
}
