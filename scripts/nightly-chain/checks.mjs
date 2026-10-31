// MPC-7557: pure checks for the nightly chain test. No network, no secrets: every function takes data and returns problems, so CI can prove them.
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

/** The request body for POST /api/scan (the same shape the /scan page sends). */
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

/** A link "resolves" when it answers 2xx or redirects (3xx) to somewhere that does. A 404/410/5xx or a network error does not. */
export async function resolveLinks(urls, fetchImpl = fetch, { timeoutMs = 10000 } = {}) {
  const bad = [];
  for (const u of urls) {
    try {
      const res = await fetchImpl(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'mpt-nightly-chain/1 (+https://myprivacytool.io)' } });
      if (!(res.status >= 200 && res.status < 300)) bad.push(`${u.replace(/[?#].*/, '')} -> HTTP ${res.status}`);
    } catch (e) { bad.push(`${u.replace(/[?#].*/, '')} -> ${String(e.name || 'error')}`); }
  }
  return bad;
}

/** Steps of the chain in order. The first failing step stops the run; later ones are reported as skipped, never as passed. */
export const STEPS = ['scan_request', 'saved_scan', 'linked_contact_consent', 'report_request', 'first_email_accepted', 'report_sent', 'report_checks', 'links_resolve', 'delivery_event_seen'];
export const WEEKLY_STEPS = ['unsubscribe', 'suppression_recorded', 'delete_by_scan_number', 'cleanup'];

export { HARD_LIMIT_BYTES };
