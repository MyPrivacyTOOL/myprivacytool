// MPC-9813 (Chris Decision 7, 2026-11-07): the email click-to-confirm gate, and the storage + running of the "show us your listing" check.
//
// Why: anyone can type anyone's email address into the form. Until the person who owns the inbox has pressed the confirm button in the email we sent,
// we send no report and we run no check that uses details about a person. The browser-only result on the visitor's own screen is unaffected.
// "We only check details you've confirmed are yours."
//
// Switches (wrangler.toml), anything but the exact string "true" is off:
//   EMAIL_CONFIRM_GATE_ENABLED  new scans wait for the click. Needs migration 20261107140000 (scans.email_confirm_required / email_confirmed_at).
//   LISTING_CHECK_ENABLED       the optional details + pasted pages are accepted, stored and checked after the click. Needs the gate and the same migration.
// Scans created before the gate existed have email_confirm_required = false and behave exactly as before.
import { readVerifyToken } from './live.js';
import { checkListingPages } from './listingCheck.js';
import { guideFor } from './brokers.js';
import { accountTokenForConfirm } from './accounts.js';

export const confirmGateEnabled = (env) => env.EMAIL_CONFIRM_GATE_ENABLED === 'true';
export const listingCheckEnabled = (env) => env.LISTING_CHECK_ENABLED === 'true' && confirmGateEnabled(env);

/** Marks a new scan as waiting for the click. Throws if it cannot (the request then fails and nothing is stored further or sent: fail closed). */
export async function applyConfirmGate(sb, scanId) {
  const rows = await sb.patch(`scans?id=eq.${scanId}`, { email_confirm_required: true });
  if (!Array.isArray(rows) || !rows.length) throw new Error('confirm gate: scan row not found');
}

/** True when this scan row still waits for the click. */
export const awaitsConfirm = (scan) => Boolean(scan?.email_confirm_required) && !scan?.email_confirmed_at;

/** Stores what the visitor typed, against the saved scan (scan number). Never throws; returns true when stored. Counts only in logs. */
export async function storeListingInputs(sb, { webScanId, scanId, listing }) {
  try {
    await sb.insert('web_scan_listing_checks', {
      web_scan_id: webScanId, scan_id: scanId,
      full_name: listing.full_name, city_region: listing.city_region, country: listing.country, phone: listing.phone,
      listing_urls: listing.urls ?? [],
    });
    return true;
  } catch (e) {
    console.error('listing inputs not stored:', e.status || 'error');
    return false;
  }
}

const reduce = (r) => ({
  key: r.key, name: r.name, host: r.host ?? null, state: r.state, match: r.match ?? null, confidence: r.confidence ?? null, is_guess: Boolean(r.is_guess),
  not_checked_reason: r.not_checked_reason ?? null, note: r.note ?? null, evidence_url: r.evidence_url ?? null, source: r.source ?? null, guide: r.guide ?? null,
});

/**
 * Reads the stored pages for a CONFIRMED scan once and keeps only the result fields. A scan that already has results is not read again.
 * Returns the stored results (an array, possibly empty) or null when there is nothing to check. Never throws.
 */
export async function runStoredListingChecks(env, sb, scanId, email, fetchImpl = undefined) {
  try {
    const row = (await sb.select(`web_scan_listing_checks?scan_id=eq.${scanId}&select=id,full_name,city_region,phone,listing_urls,results&limit=1`))?.[0];
    if (!row) return null;
    if (Array.isArray(row.results)) return row.results;
    const urls = row.listing_urls || [];
    const results = urls.length
      ? (await checkListingPages(urls, { email, full_name: row.full_name, city_region: row.city_region, phone: row.phone }, { fetchImpl })).map(reduce)
      : [];
    // Only the first writer wins: a second run (click and report job together) never overwrites results already stored.
    await sb.patch(`web_scan_listing_checks?id=eq.${row.id}&results=is.null`, { results, checked_at: new Date().toISOString() });
    return results;
  } catch (e) {
    console.error('listing check failed:', e.status || 'error');
    return null;
  }
}

/** The stored results with each guide attached, in the shape the screen and the email render. null = no check was set up for this scan, [] = set up and nothing to show. */
export async function loadListings(sb, scanId) {
  try {
    const row = (await sb.select(`web_scan_listing_checks?scan_id=eq.${scanId}&select=results,listing_urls&limit=1`))?.[0];
    if (!row) return null;
    if (!Array.isArray(row.results)) return (row.listing_urls || []).length ? { pending: true, items: [] } : { pending: false, items: [] };
    return { pending: false, items: row.results.map((r) => ({ ...r, guide: r.guide && typeof r.guide === 'object' ? r.guide : guideFor(r.guide) })) };
  } catch (e) {
    console.error('listing results not read:', e.status || 'error');
    return null;
  }
}

/**
 * POST /api/scan/confirm  (Authorization: Bearer <email link key>)  -> { confirmed: true }.
 * The key comes only from the email we sent to the address, so pressing the button proves the reader holds that inbox.
 * It sets scans.email_confirmed_at once (a second press changes nothing) and starts the page check in the background.
 */
export async function handleConfirm(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  if (!confirmGateEnabled(env)) return new Response('Not found', { status: 404 });
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!env.UNSUBSCRIBE_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  if (await rateLimited(env, request, 'scan-confirm:')) return json({ error: 'Too many requests' }, 429);
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const scanId = bearer ? await readVerifyToken(env, bearer) : null;
  if (!scanId) return json({ error: 'Invalid or expired' }, 401);
  try {
    const scan = (await sb.select(`scans?id=eq.${scanId}&select=id,email_scanned,email_confirm_required,email_confirmed_at&limit=1`))?.[0];
    if (!scan) return json({ error: 'Invalid or expired' }, 401);
    if (!scan.email_confirmed_at) {
      await sb.patch(`scans?id=eq.${scanId}&email_confirmed_at=is.null`, { email_confirmed_at: new Date().toISOString() });
    }
    if (listingCheckEnabled(env)) {
      const job = runStoredListingChecks(env, sb, scanId, scan.email_scanned);
      if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    }
    // MPC-9817: the one-step "keep my scan / create my free account" tick. The click proves the inbox, so it is also the sign-in: hand back a one-time token for the page to redeem.
    const account = await accountTokenForConfirm(env, sb, scanId, scan.email_scanned);
    return json({ confirmed: true, ...(account ? { account } : {}) });
  } catch (e) {
    console.error('confirm failed:', String(e).replace(/\S+@\S+/g, '[email]'));
    return json({ error: 'Unavailable' }, 503);
  }
}
