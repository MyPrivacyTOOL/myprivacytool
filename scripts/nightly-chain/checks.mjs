// MPC-7557: pure checks for the nightly chain test. No network, no secrets: every function takes data and returns problems, so CI can prove them.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkEmail, htmlLinks, HARD_LIMIT_BYTES } from '../../workers/scan-report/lib/renderChecks.js';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { captureStatus } from '../../shared/hexagon-registry/status.js';

export const BRIDGE = 'You saw what your browser gives away. Now look at what one email address gives away.';
export const STATUSES = new Set(['found', 'clear', 'not_checked']);

/** Synthetic scan sent by the nightly run. Values are obviously fake and personal to nobody. The site would also send `status`; here it is computed the same way (captureStatus). */
const FIXTURE_VALUES = {
  location: 'Testville (synthetic nightly test)', browser: 'Chrome 130 (synthetic)', screen: '1920 x 1080', isp: 'Synthetic Test ISP',
  'cookies-status': 'Empty', 'https-status': 'Secure (HTTPS) TLS 1.3', 'webrtc-leak': 'Blocked', 'primary-language': 'en-US',
};
export function fixtureScan() {
  return Object.entries(FIXTURE_VALUES).map(([id, value]) => {
    const h = HEXAGONS.find((x) => x.id === id);
    if (!h) throw new Error(`fixture hexagon ${id} is not in the registry`);
    return { id, label: h.label, value, status: captureStatus(id, value) };
  });
}

/** The scan-consent wording version the Worker accepts, read from the one place it lives (plain node cannot import the .ts), so a wording change needs no edit here. */
export function consentVersion() {
  const v = readFileSync(new URL('../../shared/recipients/consent-config.ts', import.meta.url), 'utf8').match(/consent_version:\s*"([^"]+)"/)?.[1];
  if (!v) throw new Error('consent_version not found in shared/recipients/consent-config.ts');
  return v;
}

/** The request body for POST /api/consent. Nobody is shown wording in this test, so the text hash names a synthetic text rather than posing as the real one. */
export function consentRequestBody(scanId) {
  return { scan_id: scanId, consent_version: consentVersion(), consent_text_sha256: createHash('sha256').update('nightly-chain synthetic consent').digest('hex'), locale: 'en' };
}

/** The request body for POST /api/scan (the same shape the /scan page sends). The caller adds the consent_id that POST /api/consent returned. */
export function scanRequestBody(email, hexagons, { requestId } = {}) {
  return {
    email, consent: true, consent_source: 'synthetic_nightly', scan: hexagons, save_consent: true, save_consent_version: '2026-10-12-v1',
    started_ms: 1000, utm_source: 'synthetic', utm_medium: 'nightly', utm_campaign: 'mpc-7557', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...(requestId ? { request_id: requestId } : {}),
  };
}

/**
 * Checks the report the run produced. `report` = { html, text, json } where json is the parsed JSON attachment (or null).
 * `fixture` = what was sent; a FOUND hexagon the scan sent must be FOUND with its value in the JSON, and nothing the scan did not send may be FOUND.
 */
export function checkReport({ html, text, json }, { scanNumber, fixture }) {
  const problems = checkEmail({ html, text, kind: 'report', scanNumber, bridge: BRIDGE });
  if (!json) { problems.push('JSON attachment missing or not valid JSON'); return problems; }
  const web = json?.web_scan, email = json?.email;
  if (!web || !Array.isArray(web.hexagons) || !email || !Array.isArray(email.hexagons)) { problems.push('JSON attachment lacks the web_scan / email parts'); return problems; }
  if (web.id !== scanNumber) problems.push('JSON web_scan.id is not the scan number');
  if (web.hexagons.length !== HEXAGONS.length) problems.push(`JSON has ${web.hexagons.length} web hexagons, registry has ${HEXAGONS.length}`);
  for (const h of [...web.hexagons, ...email.hexagons]) if (!STATUSES.has(h.status)) problems.push(`hexagon ${h.id} has status "${h.status}"`);
  const sent = new Map(fixture.map((f) => [f.id, f]));
  for (const h of web.hexagons) {
    const f = sent.get(h.id);
    if (!f && h.status === 'found') problems.push(`hexagon ${h.id} is FOUND but the scan never sent it`);
    if (f?.status === 'found' && (h.status !== 'found' || h.value !== f.value)) problems.push(`hexagon ${h.id}: scan sent a real value, report does not show it as FOUND with that value`);
    if (f?.status !== 'found' && f && h.status === 'found') problems.push(`hexagon ${h.id}: scan sent no finding, report says FOUND`);
  }
  const sum = web.summary;
  if (sum && sum.found + sum.clear + sum.not_checked !== sum.total) problems.push('JSON web_scan.summary does not add up');
  return problems;
}

/** Only https links on our own site and the guides/HIBP pages are fetched; the unsubscribe link is never fetched here (a GET only shows a confirm page, but it is signed per address). */
export function linksToResolve(html) {
  return [...new Set(htmlLinks(html))].filter((l) => !/\/unsubscribe\?/.test(l) && !/\/scan\/live/.test(l)).map((l) => l.replace(/&amp;/g, '&')).slice(0, 25);
}

/**
 * MPC-10608 (decided 2026-11-17 HKT): some data broker opt-out pages answer HTTP 403 to any automated request. A 403 is tolerated ONLY for a host on this list,
 * and a host is listed ONLY after a person or session has opened its opt-out link in a real browser and seen the opt-out page. It is reported as
 * "automated check blocked", never as a working link. Every other 403, and 404, 410, 5xx, DNS, TLS errors and timeouts, stay failures.
 * Re-open each listed link in a browser monthly; remove a host whose page no longer opens. `verified` is the HKT date of the last browser check.
 */
export const BOT_BLOCKED_VERIFIED_HOSTS = {
  'www.truthfinder.com': { verified: '2026-11-27', saw: 'redirects to the PeopleConnect Suppression Center (the opt-out form)' },
  'www.beenverified.com': { verified: '2026-11-27', saw: 'checked by a person in their own browser: the people-search opt-out page with its record search form' },
  'www.mylife.com': { verified: '2026-11-27', saw: 'checked by a person in their own browser: the deletion and opt-out form' },
  'www.intelius.com': { verified: '2026-11-27', saw: 'checked by a person in their own browser: the PeopleConnect Suppression Center (the opt-out form)' },
};
// Not listed on purpose: www.whitepages.com and www.fastpeoplesearch.com showed a block page, not the opt-out page, in that browser check (2026-11-27 HKT).

/**
 * MPC-10608 (decided 2026-11-27 HKT): one more exception, for one host and one error only. This server sends its certificate without the intermediate one.
 * Browsers fetch the missing certificate and open the page; Node does not and refuses the connection. Same rules as above: browser-checked monthly, reported
 * as "automated check blocked". Any other error on this host (expired or wrong-name certificate, DNS, timeout, any HTTP status) still fails.
 */
export const CERT_CHAIN_VERIFIED_HOSTS = {
  'help.whitepages.com.au': { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', verified: '2026-11-27', saw: 'the "My residential listing" help page' },
};

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

/**
 * A link "resolves" when it answers 2xx or redirects (3xx) to somewhere that does. A 404/410/5xx or a network error does not.
 * Returns the failures. A tolerated refusal (see above) is not a failure and is pushed to `blocked` as "host (reason)", so the caller can count it separately.
 */
export async function resolveLinks(urls, fetchImpl = fetch, { timeoutMs = 10000, blocked = [], allowedHosts = BOT_BLOCKED_VERIFIED_HOSTS, certHosts = CERT_CHAIN_VERIFIED_HOSTS } = {}) {
  const bad = [];
  for (const u of urls) {
    try {
      const res = await fetchImpl(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'mpt-nightly-chain/1 (+https://myprivacytool.io)' } });
      if (res.status >= 200 && res.status < 300) continue;
      // The refusal must come from the listed host itself: a redirect that ends in a 403 somewhere else is not covered.
      const host = hostOf(u);
      if (res.status === 403 && Object.hasOwn(allowedHosts, host) && (!res.url || hostOf(res.url) === host)) blocked.push(`${host} (HTTP 403)`);
      else bad.push(`${u.replace(/[?#].*/, '')} -> HTTP ${res.status}`);
    } catch (e) {
      const host = hostOf(u); const code = typeof e.cause?.code === 'string' ? e.cause.code : '';
      if (code && Object.hasOwn(certHosts, host) && certHosts[host].code === code) blocked.push(`${host} (incomplete certificate chain)`);
      else bad.push(`${u.replace(/[?#].*/, '')} -> ${String(e.name || 'error')}${code ? ` (${code})` : ''}`);
    }
  }
  return bad;
}

/** Steps of the chain in order. The first failing step stops the run; later ones are reported as skipped, never as passed. */
export const STEPS = ['db_ready', 'scan_request', 'saved_scan', 'linked_contact_consent', 'report_request', 'first_email_accepted', 'report_sent', 'report_checks', 'links_resolve', 'delivery_event_seen'];
// What the scan-report Worker needs from the production database (MPC-7557). The CK-8503 receipts function was missing for days while its task read 'applied';
// this list is checked every night with calls that change nothing. Names only; nothing here is an address.
export const DB_REQUIRED = {
  functions: [
    ['mpt_record_email_receipt', { p_message_id: 'db-ready-probe', p_status: 'sent' }],          // updates 0 rows
    ['mpt_record_email_event', { p_message_id: 'db-ready-probe', p_status: 'sent', p_bounce_type: null }],   // updates 0 rows
    ['mpt_email_delivery_counts', { p_from: '2000-01-01T00:00:00Z', p_to: '2000-01-02T00:00:00Z' }],           // read only
    ['mpt_request_scan', { p_user_id: '00000000-0000-4000-8000-000000000000', p_email: 'db-ready-probe', p_window: '1 second' }],   // window out of range: raises before any insert, so it exists (400) or not (404)
  ],
  columns: [
    ['scans', ['id', 'delivery_status', 'delivery_status_at', 'fixed_at', 'followup_ended', 'resend_message_id']],
    ['email_sends', ['provider_message_id', 'status', 'click_count']],
    ['email_suppressions', ['email_hash']],
  ],
};
export const WEEKLY_STEPS = ['unsubscribe', 'suppression_recorded', 'delete_by_scan_number', 'cleanup'];

export { HARD_LIMIT_BYTES };
