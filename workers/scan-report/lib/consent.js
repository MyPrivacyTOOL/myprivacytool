// MPC-9887 (Open Tracker design 2.1, 2.3): the scan-consent endpoints. First-party and pre-click: they call nothing but our own database.
//
//   POST /api/consent         { scan_id, consent_version, consent_text_sha256, locale }  ->  { consent_id, scan_id, consent_version, n_hours, consented_at, created }
//   GET  /api/consent?scan_id=<uuid>                                                    ->  the same shape, or 404 when no consent exists for that scan id
//
// One consent per scan id. A second POST (another door of the same journey, a retry) returns the first and writes nothing; the GET lets a channel or the
// web gate ask whether a journey is already consented, so it never asks twice. Nothing here stores an IP, an email or a user agent.
import { parseConsentRequest, recordConsent, findConsentByScan, findConsentById, isUuid, CONSENT_CONFIG } from '../../../shared/recipients/consent.ts';
import { readCappedJson } from './webScan.js';

const MAX_BODY = 2 * 1024;
const shape = (row, created) => ({ consent_id: row.id, scan_id: row.scan_id, consent_version: row.consent_version, n_hours: row.n_hours, consented_at: row.consented_at, ...(created === undefined ? {} : { created }) });

/** Is the consent gate switched on for scans? Exactly "true", like every other switch. */
export const consentEnforced = (env) => env.CONSENT_GATE_ENFORCED === 'true';

export async function handleConsent(env, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  if (await rateLimited(env, request, 'consent:')) return json({ error: 'Too many requests' }, 429);
  try {
    if (request.method === 'GET') {
      const scanId = new URL(request.url).searchParams.get('scan_id');
      if (!isUuid(scanId)) return json({ error: 'Invalid scan id' }, 400);
      const row = await findConsentByScan(sb, scanId);
      return row ? json(shape(row)) : json({ error: 'No consent on record' }, 404);
    }
    const read = await readCappedJson(request, MAX_BODY);
    if (read.status) return json({ error: read.status === 413 ? 'Payload too large' : 'Invalid request' }, read.status);
    const parsed = parseConsentRequest(read.body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const { created, row } = await recordConsent(sb, parsed.value);
    return json(shape(row, created), created ? 201 : 200);
  } catch (e) {
    console.error('consent failed:', e?.status || 'error');   // status only: nothing the visitor sent goes to the log
    return json({ error: 'Could not record consent' }, 500);
  }
}

/**
 * The server-side gate for POST /api/scan. Returns { consent } (the stored row, or null when the gate is off and the request carries none) or
 * { refuse: { status, code, error } }. A consent id that is not in the store is always refused, whatever the switch says: a forged, stale or deleted id
 * is never "close enough". A store that cannot be read refuses (503-shaped as 403 consent_unverifiable) rather than letting the request through.
 */
export async function gateScanRequest(env, body, sb) {
  const supplied = body?.consent_id;
  if (supplied === undefined || supplied === null) {
    return consentEnforced(env) ? { refuse: { status: 403, code: 'consent_required', error: 'Consent required' } } : { consent: null };
  }
  if (!isUuid(supplied)) return { refuse: { status: 403, code: 'consent_invalid', error: 'Consent required' } };
  let row;
  try { row = await findConsentById(sb, supplied); }
  catch { return { refuse: { status: 403, code: 'consent_unverifiable', error: 'Consent could not be checked' } }; }
  return row ? { consent: row } : { refuse: { status: 403, code: 'consent_invalid', error: 'Consent required' } };
}

export { CONSENT_CONFIG };
