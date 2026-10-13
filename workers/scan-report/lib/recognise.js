// MPC-7494 (inbound funnels F5): the open mirror. "Welcome back, we recognised your device without a cookie."
//
// MyPrivacyTOOL is a mirror, not a tracker. This module recognises a returning device in the open: the answer goes to the visitor
// who is looking at the screen, with the signals that matched, and nothing about a match is stored or used anywhere else.
//   - It never writes: no insert, patch or delete anywhere in the recognise path (the test checks the stubbed database saw only reads).
//   - It runs only for a browser that holds the scan number of a scan the visitor SAVED WITH THE SPECIFIC CONSENT (the "save my scan
//     result" box, MPC-7470: a save_consent_at record on the contact link) AND gave the separate "recognise this device" consent
//     (recognise_consent_at on the same link, MPC-7494). No consent record, no comparison.
//   - It compares only against saved scans that carry both consent records and are still inside the retention period (the database
//     function mpt_recognition_candidates enforces all three).
//   - It uses only hexagons the registry marks "measured", and only those the site recorded as FOUND at capture (MPC-7487).
//   - It never tries to say WHO the visitor is: no contact, email or user id is read, compared or returned.
//   - Switch: RECOGNITION_ENABLED must be exactly "true" (wrangler.toml: "false"), and saving (WEB_SCAN_SAVE_ENABLED) must be on.
import { HEXAGONS } from '../../../shared/hexagon-registry/registry.js';
import { isScanNumber, readCappedJson, validateHexagons, webScanEnabled, MAX_WEB_SCAN_BYTES } from './webScan.js';

// The signals the match is built from. Weight = how much a match on that signal tells us about the DEVICE (not the session).
//   hash:true   high-entropy values that two different devices almost never share. A match needs at least one of them to agree,
//               and any of them that is present on both sides and DIFFERS vetoes the match.
// Left out on purpose: everything about the session (time, session duration, mouse, typing, click, scroll, engagement, orientation, tilt,
// rotation, referrer, battery, connection, network leak tests, storage counts, security status), every ESTIMATE hexagon (location, ISP,
// age band, profile) and every CANNOT BE CHECKED hexagon. They change from visit to visit or are not real measurements of the device.
export const RECOGNITION_SIGNALS = [
  { id: 'canvas-fingerprint', weight: 3, hash: true },
  { id: 'audio-fingerprint', weight: 3, hash: true },
  { id: 'webgl-fingerprint', weight: 2 },
  { id: 'font-detection', weight: 2 },
  { id: 'screen-fingerprint', weight: 2 },
  { id: 'hardware-profile', weight: 2 },
  { id: 'timezone-locale', weight: 2 },
  { id: 'device', weight: 1 },
  { id: 'browser', weight: 1 },
  { id: 'primary-language', weight: 1 },
  { id: 'language-fallbacks', weight: 1 },
];
export const TOTAL_WEIGHT = RECOGNITION_SIGNALS.reduce((n, s) => n + s.weight, 0);   // 20

// THE THRESHOLD. A match is declared only when ALL of these hold:
//   1. At least MIN_EVIDENCE of the 20 weight points are comparable (a found, non-empty value on both scans). 12 = 60%: one hash plus
//      most of the rest must be on both sides, so two scans that share only a couple of common values can never match.
//   2. At least MIN_HASHES of the two hash signals (canvas, audio) are comparable and equal.
//   3. No comparable hash signal differs (a different canvas or audio hash means a different device or a different browser profile).
//   4. The agreeing weight is at least MIN_AGREEMENT (0.85) of the comparable weight. That allows a real device to differ by at most
//      3 weight points among the soft signals (for example a browser update, 1, plus an external monitor changing the display profile, 2)
//      and still be recognised, but never by its hardware identity: a hash mismatch is a veto, not a point lost.
// Why 0.85 and not stricter: browsers update every few weeks and screens get plugged in; a threshold of 1.0 would call the same laptop a
// stranger after one update, which shows the visitor nothing and teaches us nothing. Why not looser: below ~0.85 two identical
// office machines would start matching each other on the soft signals alone. Even at 0.85, two machines imaged identically by an
// employer can share every signal, so the screen must say "this may be another device just like yours" (the caveat returned below).
export const MIN_EVIDENCE = 12;
export const MIN_HASHES = 1;
export const MIN_AGREEMENT = 0.85;
export const CAVEAT = 'Two devices set up identically, for example by an employer, can look the same. If this is not your device, delete the record.';

const REGISTRY = new Map(HEXAGONS.map((h) => [h.id, h]));
// Fail loudly at import if a signal is not a measured registry hexagon (the registry is the source of truth; recognise.test.mjs checks it too).
for (const s of RECOGNITION_SIGNALS) {
  const h = REGISTRY.get(s.id);
  if (!h || h.truth.level !== 'measured') throw new Error(`recognition signal ${s.id} is not a measured registry hexagon`);
}
const HASH_IDS = RECOGNITION_SIGNALS.filter((s) => s.hash).map((s) => s.id);

export const recognitionEnabled = (env) => env.RECOGNITION_ENABLED === 'true' && webScanEnabled(env);

const norm = (v) => String(v).trim().toLowerCase();
// A hexagon is comparable when the site recorded it as found (MPC-7487) with a real value. A scan saved before statuses existed has no
// 'found' flags, so none of its signals count (strict, like the report).
const usable = (h) => h && h.status === 'found' && typeof h.value === 'string' && norm(h.value) !== '';
const byId = (list) => new Map((Array.isArray(list) ? list : []).map((h) => [h?.id, h]));

// Compares the new scan with ONE saved scan. Pure; returns the numbers and the ids of the signals that agreed.
export function compareScans(newHexagons, savedHexagons) {
  const a = byId(newHexagons); const b = byId(savedHexagons);
  let evidence = 0; let agreed = 0; let hashesAgreed = 0; let hashVeto = false;
  const matched = [];
  for (const s of RECOGNITION_SIGNALS) {
    const x = a.get(s.id); const y = b.get(s.id);
    if (!usable(x) || !usable(y)) continue;
    evidence += s.weight;
    if (norm(x.value) === norm(y.value)) {
      agreed += s.weight; matched.push(s.id);
      if (s.hash) hashesAgreed += 1;
    } else if (s.hash) hashVeto = true;
  }
  const agreement = evidence > 0 ? agreed / evidence : 0;
  let verdict = 'match';
  if (hashVeto) verdict = 'hash_differs';
  else if (evidence < MIN_EVIDENCE) verdict = 'not_enough_evidence';
  else if (hashesAgreed < MIN_HASHES) verdict = 'no_hash_agreed';
  else if (agreement < MIN_AGREEMENT) verdict = 'below_threshold';
  return { verdict, evidence, agreed, agreement, matched };
}

// Picks the best match among candidate saved scans [{web_scan_id, scanned_at, results}]. Returns { recognised: false, reason } or
// { recognised: true, ... }. Highest agreement wins, then more evidence, then the most recent scan.
export function recognise(newHexagons, candidates) {
  let best = null; let reason = 'no_candidates';
  for (const c of candidates || []) {
    const r = compareScans(newHexagons, c.results);
    if (r.verdict !== 'match') { if (!best) reason = r.verdict; continue; }
    const better = !best || r.agreement > best.agreement || (r.agreement === best.agreement && (r.evidence > best.evidence || (r.evidence === best.evidence && c.scanned_at > best.scanned_at)));
    if (better) best = { ...r, scanNumber: c.web_scan_id, scannedAt: c.scanned_at };
  }
  if (!best) return { recognised: false, reason };
  return { recognised: true, ...best };
}

// What the visitor is shown. Signal labels come from the registry (trusted text), never from stored values. The date is the day only (UTC).
export function toVisitorView(r) {
  return {
    recognised: true,
    scan_number: r.scanNumber,
    last_seen: new Date(r.scannedAt).toISOString().slice(0, 10),
    signals: r.matched.map((id) => ({ id, label: REGISTRY.get(id).label })),
    signals_compared: Math.round(r.evidence),
    match: { agreement: Math.round(r.agreement * 100) / 100, threshold: MIN_AGREEMENT },
    caveat: CAVEAT,
  };
}

// POST /api/recognise {hexagons:[...], held_scan_number} -> {recognised:false} | {recognised:true, ...view}.
// hexagons = the scan this browser has just finished; held_scan_number = the scan number this browser kept from its earlier saved scan.
// Every reason for "no" answers the same {recognised:false}, so the endpoint cannot be used to find out which scan numbers exist.
export async function handleRecognise(env, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!recognitionEnabled(env)) return json({ recognised: false });   // off: nothing read, nothing compared
  if (await rateLimited(env, request, 'recognise:')) return json({ error: 'Too many requests' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  const read = await readCappedJson(request, MAX_WEB_SCAN_BYTES + 1024);
  if (read.status) return json({ error: read.status === 413 ? 'Payload too large' : 'Invalid request' }, read.status);
  const b = read.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'Invalid request' }, 400);
  for (const k of Object.keys(b)) if (!['hexagons', 'held_scan_number'].includes(k)) return json({ error: 'Invalid request' }, 400);
  if (!isScanNumber(b.held_scan_number)) return json({ error: 'Invalid request' }, 400);
  const v = validateHexagons(b.hexagons);
  if (v.error) return json({ error: v.error }, 400);
  try {
    // 1. The visitor must hold a scan that was saved with the specific save consent AND the separate "recognise this device" consent (MPC-7494).
    const consent = await sb.select(`web_scan_contacts?web_scan_id=eq.${b.held_scan_number.toLowerCase()}&save_consent_at=not.is.null&recognise_consent_at=not.is.null&select=id&limit=1`);
    if (!consent?.length) return json({ recognised: false });
    // 2. Only the hash values go to the database, to find candidates; the database returns consented, unexpired scans only.
    const hashes = v.hexagons.filter((h) => HASH_IDS.includes(h.id) && usable(h)).map((h) => ({ id: h.id, value: h.value }));
    if (!hashes.length) return json({ recognised: false });
    const candidates = await sb.rpc('mpt_recognition_candidates', { p_hashes: hashes, p_limit: 200 });
    const r = recognise(v.hexagons, candidates);
    return json(r.recognised ? toVisitorView(r) : { recognised: false });
  } catch (e) {
    console.error('recognise failed:', e.status || 'error');   // status only: the message could carry visitor values
    return json({ recognised: false });
  }
}

// POST /api/recognise/delete {scan_number} -> {deleted}. The "delete my record" button on the welcome-back screen: the MPC-7488 deletion
// route (mpt_delete_web_scan), by scan number. Same switch as recognition.
export async function handleRecogniseDelete(env, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!recognitionEnabled(env)) return json({ deleted: false });
  if (await rateLimited(env, request, 'recognise-delete:')) return json({ error: 'Too many requests' }, 429);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  const read = await readCappedJson(request, 512);
  if (read.status) return json({ error: read.status === 413 ? 'Payload too large' : 'Invalid request' }, read.status);
  const b = read.body;
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => k !== 'scan_number') || !isScanNumber(b.scan_number)) return json({ error: 'Invalid request' }, 400);
  try {
    const res = await sb.rpc('mpt_delete_web_scan', { p_scan_number: b.scan_number.toLowerCase() });
    return json({ deleted: res?.found === true });
  } catch (e) {
    console.error('recognise delete failed:', e.status || 'error');
    return json({ error: 'Could not delete the record' }, 500);
  }
}
