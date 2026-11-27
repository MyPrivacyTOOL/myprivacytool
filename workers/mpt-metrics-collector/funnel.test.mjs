// CK-11491: the weekly funnel line on the KPI tracker row. Stubbed, no network. Run: node workers/mpt-metrics-collector/funnel.test.mjs
import { FUNNEL_EVENTS, funnelCounts, funnelLine, readFunnel, weeklyProperties } from './publishers/notion.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const ev = (name, n) => ({ dimensionValues: [{ value: name }], metricValues: [{ value: String(n) }] });
const day = (d, ...rows) => ({ period_start: d, payload: { rows } });
const f = funnelCounts([
  day('2026-11-30', ev('scan_start', 99)),
  day('2026-11-30', ev('scan_start', 10), ev('scan_complete', 4), ev('page_view', 50), ev('toString', 3)),   // a later capture of the same day wins
  day('2026-12-01', ev('scan_start', 2), ev('pricing_view', 3), ev('checkout_start', 1)),
]);
check(f.days === 2 && f.counts.scan_start === 12 && f.counts.scan_complete === 4 && f.counts.pricing_view === 3 && f.counts.checkout_start === 1 && f.counts.report_view === 0, 'one row per day; only funnel events are summed');
check(Object.keys(f.counts).join() === FUNNEL_EVENTS.join(), 'no other event name gets in');
const line = funnelLine('2026-11-30', { ga4: f, reportEmails: 8, reportViews: 2 });
check(/scan_start 12, scan_complete 4, report_view 0, pricing_view 3, checkout_start 1/.test(line) && /Scan completion rate 33.3%/.test(line) && /Report view rate 25%/.test(line) && !/PARTIAL/.test(line), 'counts and both rates');
const none = funnelLine('2026-11-30', { ga4: funnelCounts([]), reportEmails: 0, reportViews: 0 });
check(/GA4: blank/.test(none) && /Report view rate blank/.test(none) && !/ 0%/.test(none), 'nothing collected or nothing to divide by => blank, never 0%');
check(/Report view rate blank\./.test(funnelLine('2026-11-30', { ga4: null, reportEmails: null, reportViews: 3 })), 'a failed read stays blank');
check(/PARTIAL/.test(funnelLine('2026-11-23', { ga4: f, reportEmails: 1, reportViews: 0 })), 'the launch week is marked partial');
check(funnelLine('2026-11-16', { ga4: f, reportEmails: 1, reportViews: 0 }) === null && funnelLine('2026-11-30', null) === null, 'no line for weeks before the events existed');

// The row's text is capped at 1900 characters: the funnel line must fit inside it, with every other line filled in.
const view = { cumulative_scans: 9999, conversion_rate_pct: 12.34, current_mrr: 12345, ga4_active_users: 9999, blog_posts_published: 99, x_threads_posted: 99, engagement_sessions: 999, engagement_full_scans: 999, ga4_scan_events: 999 };
const text = weeklyProperties('2026-11-23', view, '2026-11-30T16:15:00.000Z', null, { cost_per_scan: 12.5, cac: 99, cost: 999, scan_started: 99, paid_conversions: 9, days: 7 }, { ga4: { days: 7, counts: Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 99999])) }, reportEmails: 9999, reportViews: 9999 })['Agent Insights'].rich_text[0].text.content;
check(text.includes('Funnel (CK-11491)') && /Report view rate [0-9.]+%\./.test(text), `funnel line survives the 1900 character cap (text is ${text.length})`);

// Before the migration is applied no view can be recorded, so the row must say blank, not 0.
const readWith = async (columnThere) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => (!columnThere && String(url).includes('scans?select=report_viewed_at')
    ? new Response('{"code":"42703"}', { status: 400 })
    : new Response(JSON.stringify(String(url).includes('email_sends') ? [{ id: 'a' }, { id: 'b' }] : []), { status: 200, headers: { 'content-type': 'application/json' } }));
  try { return await readFunnel({ SUPABASE_URL: 'https://xmdmkumwxpgahmlweuug.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, '2026-11-30'); } finally { globalThis.fetch = real; }
};
const before = await readWith(false), after = await readWith(true);
check(before.reportViews === null && before.reportEmails === 2, 'column missing => report views blank');
check(after.reportViews === 0 && after.reportEmails === 2, 'column present and nothing counted => a real 0');

process.exit(ok ? 0 : 1);
