// MPC-9813: pure checks for the automated live check of the email confirm gate and the "show us your listing" check. No network, no secrets.
export const FIXTURE_URL = 'https://www.myprivacytool.io/test-fixtures/listing-synthetic.html';
export const IDENTITY = { full_name: 'Zelda Quillfeather', city_region: 'Austin, TX', country: 'US', phone: '5125550142' };   // invented person

/** The POST /api/scan body: the nightly chain's synthetic scan plus the typed details and the pasted page. */
export function f1Body(email, hexagons) {
  return {
    email, consent: true, consent_source: 'synthetic_f1', scan: hexagons, save_consent: true, save_consent_version: '2026-10-12-v1', started_ms: 1000,
    utm_source: 'synthetic', utm_medium: 'f1-live-check', utm_campaign: 'mpc-9813', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    listing: { ...IDENTITY, urls: [FIXTURE_URL] },
  };
}

/** Problems with the confirmation email as sent (empty list = fine). */
export function checkConfirmationEmail({ subject, text, html }) {
  const p = [];
  if (!/Confirm your email/i.test(subject || '')) p.push(`subject is not the click-to-confirm one: "${String(subject).slice(0, 80)}"`);
  if (!/We only check details you.ve confirmed are yours/.test(text || '')) p.push('plain text lacks the honest sentence');
  if (!/Confirm this is my email/.test(html || '')) p.push('HTML lacks the "Confirm this is my email" button');
  if (!/scan\/live#v=/.test(text || '')) p.push('plain text lacks the confirm link');
  return p;
}

/** Problems with the stored per-page result for the fixture page. */
export function checkStoredResult(results) {
  const p = [];
  if (!Array.isArray(results) || results.length !== 1) return [`expected 1 stored result, got ${Array.isArray(results) ? results.length : 'none'}`];
  const r = results[0];
  if (r.state !== 'listed') p.push(`state is "${r.state}", expected "listed" (reason: ${r.not_checked_reason || 'none'}, note: ${r.note || 'none'})`);
  if (r.match !== 'exact' || r.confidence !== 'high' || r.is_guess !== false) p.push(`match/confidence/is_guess = ${r.match}/${r.confidence}/${r.is_guess}, expected exact/high/false`);
  if (r.evidence_url !== FIXTURE_URL) p.push('evidence_url is not the pasted page');
  if (!r.source || r.source.class !== 'free' || r.source.provider !== 'user_supplied_page' || !r.source.checked_at) p.push('source is not {class: free, provider: user_supplied_page, checked_at}');
  const rest = JSON.stringify({ ...r, evidence_url: undefined });
  if (/Quillfeather|Austin|78701|555/.test(rest)) p.push('the stored result contains page text or the typed details');
  return p;
}

/** Problems with the report email as sent (text + html). */
export function checkReportBlock({ text, html }) {
  const p = [];
  if (!/LISTINGS YOU SHOWED US/.test(text || '')) p.push('report text lacks "LISTINGS YOU SHOWED US"');
  if (!/LISTED, a match for the details you gave/.test(text || '')) p.push('report text lacks the Listed state line');
  if (!(text || '').includes(FIXTURE_URL)) p.push('report text lacks the evidence page link');
  if (!/Listings you showed us/.test(html || '')) p.push('report HTML lacks the "Listings you showed us" block');
  if (/NOT LISTED/.test(text || '')) p.push('report says NOT LISTED for a page that lists the identity');
  return p;
}
