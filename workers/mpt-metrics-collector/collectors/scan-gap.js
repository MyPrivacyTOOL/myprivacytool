// MPC-7535: daily check of /scan page submissions against report requests the Worker accepted, for the previous Hong Kong day.
// The /scan page sends the lead to HubSpot first (source_tag "scan-page") and then asks the scan-report Worker for the report. If the second
// step fails for any reason the visitor used to see a thank-you screen anyway (MPC-7535 found 2026-10-12). A submission with no accepted
// request is a "gap"; any gap raises an alert in the usual Slack channel, and so does a check that could not run.
// Counts only. Email addresses pass through memory to be matched and are never stored, logged or put in the alert text.
import { hubspotRead } from './hubspot.js';
import { previousHkDay } from '../lib/hk.js';

export const SCAN_FORM_ID = '22ee30ae-6cf9-419b-aa46-b656b0e7b1bf';   // the HubSpot "Start Scan" form shared by /start and /scan
export const SCAN_SOURCE_TAG = 'scan-page';
export const MAX_CHECK = 40;      // distinct addresses matched one by one (Workers free plan: 50 subrequests per run, the rest go to other collectors)
const MAX_PAGES = 6;              // 50 submissions per page
const DEDUPE_MS = 24 * 3600000;   // the Worker makes one report per address per 24h, so a repeat within 24h is covered by the earlier request

const norm = (e) => String(e ?? '').trim().toLowerCase();

async function submittedAddresses(env, { start, end }) {
  const found = new Set();
  let after;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`scan-gap: more than ${MAX_PAGES * 50} submissions on the scan form, not checked`);
    const qs = new URLSearchParams({ limit: '50' });
    if (after) qs.set('after', after);
    const out = await hubspotRead(env, 'GET', `/form-integrations/v1/submissions/forms/${SCAN_FORM_ID}?${qs}`, 'scan form submissions');
    let reachedOlder = false;
    for (const r of out.results ?? []) {   // newest first
      const t = Number(r.submittedAt);
      if (t >= end.getTime()) continue;
      if (t < start.getTime()) { reachedOlder = true; break; }
      const v = Object.fromEntries((r.values ?? []).map((x) => [x.name, x.value]));
      if (v.source_tag === SCAN_SOURCE_TAG && v.email) found.add(norm(v.email));
    }
    after = out.paging?.next?.after;
    if (reachedOlder || !after) break;
  }
  return found;
}

async function hasReportRequest(env, email, start) {
  const since = new Date(start.getTime() - DEDUPE_MS).toISOString();
  const url = `${env.SUPABASE_URL}/rest/v1/scans?email_scanned=eq.${encodeURIComponent(email)}&source=eq.web_scan&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`scan-gap: scans read failed: HTTP ${res.status}`);
  return (await res.json()).length > 0;
}

export default {
  source: 'supabase',
  report: 'scan_report_gap',
  async collect(env, now = new Date()) {
    const win = previousHkDay(now);
    const addresses = await submittedAddresses(env, win);
    if (addresses.size > MAX_CHECK) throw new Error(`scan-gap: ${addresses.size} distinct submissions, more than the ${MAX_CHECK} that can be matched in one run`);
    let accepted = 0;
    for (const a of addresses) if (await hasReportRequest(env, a, win.start)) accepted += 1;
    const missing = addresses.size - accepted;
    return {
      payload: { day: win.day, scan_page_submissions: addresses.size, accepted_report_requests: accepted, missing, alert: missing > 0 },
      period_start: win.start.toISOString(), period_end: win.end.toISOString(),
    };
  },
  // Text for the Slack alert, or null when all is well. A check that cannot run is an alert too: a silent check is how this was missed.
  alertText(row) {
    if (row.status === 'error') return `:rotating_light: Daily scan check could NOT run (${row.error || 'unknown error'}). /scan submissions are not being compared with report requests until this is fixed.`;
    const p = row.payload || {};
    if (p.missing > 0) return `:rotating_light: ${p.missing} of ${p.scan_page_submissions} /scan submissions on ${p.day} (HKT) have no accepted report request, so those visitors were not sent a report. Check the mpt-scan-report Worker and the /scan page (MPC-7535). Counts only; no addresses in this message.`;
    return null;
  },
};
