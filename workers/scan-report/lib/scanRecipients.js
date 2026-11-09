// MPC-9893 (Open Tracker design 1.6): GET /api/scan/recipients?scan_number=<uuid>
// The read side of the per-scan "who saw what during this scan, and why" panel. Returns the scan_recipient_log rows our Workers wrote for ONE saved scan:
// recipient key, data item NAMES, time, status, HTTP status, error code. Never a value, a URL or a header (the table cannot hold them).
//
// Who may read: whoever holds the scan number. That is the same handle the visitor already uses to export or delete the scan (mpt_delete_web_scan,
// mpt_export_web_scan), it is a random uuid shown only to them, and the response contains no personal data (the panel adds the words from the public
// registry in the browser). A number that does not exist answers the same empty list as one with no rows, so the endpoint cannot be used to test numbers.
// scan_recipient_log is keyed by the server scan id (scans.id); the scan number reaches it through web_scan_contacts (channel email, contact_id = scans.id).
// First-party and read-only: nothing is sent to any outside party.
import { isUuid } from '../../../shared/recipients/consent.ts';

const MAX_ROWS = 300;
const MAX_CONTACTS = 5;   // one scan number links to one scan row today; the cap bounds the loop if that ever changes

export async function handleScanRecipients(env, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  if (await rateLimited(env, request, 'scan-recipients:')) return json({ error: 'Too many requests' }, 429);
  const number = new URL(request.url).searchParams.get('scan_number');
  if (!isUuid(number)) return json({ error: 'Invalid scan number' }, 400);
  const n = number.toLowerCase();
  try {
    const links = (await sb.select(`web_scan_contacts?web_scan_id=eq.${n}&channel=eq.email&select=contact_id&limit=${MAX_CONTACTS}`)) ?? [];
    const ids = [...new Set([n, ...links.map((l) => String(l.contact_id).toLowerCase()).filter(isUuid)])];
    const rows = [];
    for (const id of ids) {
      const part = (await sb.select(`scan_recipient_log?scan_id=eq.${id}&select=recipient_key,items,status,http_status,code,at&order=at.asc&limit=${MAX_ROWS}`)) ?? [];
      rows.push(...part);
    }
    rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    // Only the fields the panel renders, in the shape the browser's own records use (key / items / at / status), so one component reads both.
    const records = rows.slice(0, MAX_ROWS).map((r) => ({
      key: r.recipient_key, items: Array.isArray(r.items) ? r.items : [], at: r.at, status: r.status,
      ...(r.http_status != null ? { http_status: r.http_status } : {}), ...(r.code ? { code: r.code } : {}),
    }));
    return json({ scan_number: n, records });
  } catch (e) {
    console.error('scan recipients failed:', e?.status || 'error');   // status only: nothing the visitor sent goes to the log
    return json({ error: 'Could not read the record' }, 500);
  }
}
