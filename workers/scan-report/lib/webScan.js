// MPC-7465 (report email B2): a web scan is saved under a random scan number (personal data: the results hold browser-reported values such as IP addresses) and linked to a contact.
// MPC-7470 (decision D12): a scan is saved ONLY when the visitor gives an email address at the contact step AND ticks the separate
// "save my scan result" box. The site then sends the scan together with save_consent:true in the same POST /api/scan; there is no
// save-at-completion endpoint any more. The consent record (time + wording version) is stored on the contact link.
// Everything in a scan comes from the visitor's browser, so it is untrusted text: strict shape, short strings, no control
// characters, never logged. Values are stored as given (escaped later, when anything renders them).
// Switch: WEB_SCAN_SAVE_ENABLED must be exactly "true" (wrangler.toml keeps it "false" until MPC-7470 signs off the wording).

// Wording versions of the tick-box label the visitor saw. The site sends the version with the request; an unknown version
// (for example a stale cached page with different wording) is rejected, so every stored consent record names text we can show.
// Add a new entry here whenever the label in src/lib/saveConsent.ts changes.
export const SAVE_CONSENT_VERSIONS = ['2026-10-12-v1'];

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
  status: (v) => v === 'found' || v === 'clear' || v === 'not_checked',   // MPC-7487: set by the site at capture; the report re-checks it against the registry
  estimate: (v) => typeof v === 'boolean',
};
const REQUIRED = ['id', 'label', 'value'];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const webScanEnabled = (env) => env.WEB_SCAN_SAVE_ENABLED === 'true';
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
  if (!('scan' in b) && !('save_consent' in b) && !('save_consent_version' in b)) return { none: true };
  if (b.save_consent !== true) return { error: 'Save consent required' };
  if (typeof b.save_consent_version !== 'string' || !SAVE_CONSENT_VERSIONS.includes(b.save_consent_version)) return { error: 'Unknown consent wording' };
  const v = validateHexagons(b.scan);
  if (v.error) return v;
  if (new TextEncoder().encode(JSON.stringify(v.hexagons)).length > MAX_WEB_SCAN_BYTES) return { error: 'Invalid hexagons' };   // matches the web_scans.results_bytes check
  return { hexagons: v.hexagons, version: b.save_consent_version };
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

// Saves the scan and links it to the contact in one step, with the consent record (when and which wording) on the link.
// Never throws: a failure must not cost the visitor their report. If the link cannot be written the scan row is removed again,
// so a scan never stays stored without a contact and a consent record. Returns { saved, scanNumber }.
export async function saveWebScanForContact(env, sb, { hexagons, contactId, version, now = new Date() }) {
  if (!webScanEnabled(env) || !contactId || !SAVE_CONSENT_VERSIONS.includes(version)) return { saved: false };
  let scanNumber;
  try {
    scanNumber = await saveWebScan(sb, hexagons);
  } catch (e) {
    console.error('web scan save failed:', e.status || 'error');   // status only: the message could carry visitor values
    return { saved: false };
  }
  try {
    await sb.insert('web_scan_contacts', { web_scan_id: scanNumber, channel: 'email', contact_id: contactId, save_consent_at: now.toISOString(), save_consent_version: version });
    return { saved: true, scanNumber };
  } catch (e) {
    console.error('web scan link failed:', e.status || 'error');
    await sb.remove(`web_scans?id=eq.${scanNumber}`).catch((e2) => console.error('web scan clean-up failed:', e2.status || 'error'));
    return { saved: false };
  }
}
