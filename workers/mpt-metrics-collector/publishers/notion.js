// Notion publisher (MPC-7382): turns the Supabase rollup views into one daily row and one weekly row in Notion.
// Counts and summaries only, no personal data. Re-running a day or week updates the same row (never duplicates).
// A number the views report as NULL (source missing or status=error) is left blank, never estimated.
// Rows this publisher did not create (no MARKER in Notes / Agent Insights) are left untouched.
import { hkDate, hkDayStartOf } from '../lib/hk.js';
import { learningLoopConfigured, publishLearningLoop } from './learning-loop.js';
import { notesLine as emailNotesLine } from '../collectors/email-delivery.js';
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { recipientCtx } from '../lib/recipient-ctx.js';

export const NOTION_VERSION = '2025-09-03';
export const DEFAULT_DAILY_DS = '5bf43eae-1da1-438e-859d-56b241b5b1ac'; // Management & Data Analytics MPT Hub
export const DEFAULT_WEEKLY_DS = '49361779-2050-4d96-8f69-ad1da1636810'; // MPT Total Project Channel Analytics and Metrics
export const MARKER = '[mpt-metrics-collector]';
export const OBJECTIVE = 'O3 — KPI pace';
export const PACE = { onTrack: '🟢 On Track', atRisk: '🟡 At Risk', behind: '🔴 Behind' };

const DAY_MS = 86400000;
export const isoDay = (d) => d.toISOString().slice(0, 10);
export const addDays = (day, n) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
export const mondayOf = (day) => { const d = new Date(`${day}T00:00:00Z`); return addDays(day, -((d.getUTCDay() + 6) % 7)); };
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (s) => ({ rich_text: s ? [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] : [] });
const plain = (prop) => (prop?.rich_text ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

// Pace Status rule (decision record): On Track at 0 or above, At Risk between 0 and -15, Behind below -15.
export function paceStatus(gap) {
  const g = num(gap);
  if (g === null) return null;
  return g >= 0 ? PACE.onTrack : g >= -15 ? PACE.atRisk : PACE.behind;
}

const cfg = (env) => ({
  daily: env.NOTION_DAILY_DATA_SOURCE_ID || DEFAULT_DAILY_DS,
  weekly: env.NOTION_WEEKLY_DATA_SOURCE_ID || DEFAULT_WEEKLY_DS,
});
export const notionConfigured = (env) => Boolean(env.NOTION_TOKEN && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

export async function notion(env, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await callRecipient('notion', { url: `https://api.notion.com/v1${path}`, init: {
      method,
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, sent: [] }, recipientCtx(env));
    if (res.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') || 1) * 1000)); continue; }
    if (!res.ok) throw new Error(`notion ${method} ${path.split('?')[0]} failed: HTTP ${res.status}`);
    return res.json();
  }
}

async function supa(env, path) {
  const res = await callRecipient('supabase', { url: `${env.SUPABASE_URL}/rest/v1/${path}`, init: {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }, sent: [] }, recipientCtx(env));
  if (!res.ok) throw new Error(`supabase read ${path.split('?')[0]} failed: HTTP ${res.status}`);
  return res.json();
}

const findPage = async (env, ds, property, day) =>
  (await notion(env, 'POST', `/data_sources/${ds}/query`, { filter: { property, date: { equals: day } }, page_size: 2 })).results;

// Create the row, or update the one that already exists for this key. Never touches rows without MARKER.
async function upsert(env, ds, { key, keyProperty, markerProperty, titleProperty, title, properties, createOnly }) {
  const existing = await findPage(env, ds, keyProperty, key);
  if (existing.length > 1) throw new Error(`${existing.length} rows already exist for ${keyProperty}=${key}; refusing to pick one`);
  if (existing.length === 1) {
    const page = existing[0];
    if (!plain(page.properties?.[markerProperty]).startsWith(MARKER)) return { action: 'skipped_not_ours', page };
    const updated = await notion(env, 'PATCH', `/pages/${page.id}`, { properties });
    return { action: 'updated', page: updated };
  }
  const created = await notion(env, 'POST', '/pages', {
    parent: { type: 'data_source_id', data_source_id: ds },
    properties: { [titleProperty]: { title: [{ type: 'text', text: { content: title } }] }, ...properties, ...createOnly },
  });
  return { action: 'created', page: created };
}

export function dailyProperties(day, v, totalLeads, readAt, emailDelivery) {
  const lines = [
    `${MARKER} ${day} (Hong Kong day, 00:00-24:00 HKT). Read ${readAt} from Supabase mpt_daily_metrics unless noted.`,
    `GA4 Sessions: ga4 daily_overview (activeUsers also -> Website Visitors). Supabase Signups: public.users created that day. Newsletter Signups: public.subscribers created that day.`,
    `Total Leads: supabase table_counts count of public.leads, latest pull that day. Blank = not collected or source error; nothing is estimated.`,
    ...(emailDelivery === undefined ? [] : [emailDelivery === null ? 'Email delivery: not collected for this day (source missing or errored); nothing is estimated.' : emailNotesLine(emailDelivery)]),   // MPC-7556: counts only
  ];
  return {
    Date: { date: { start: day } },
    'GA4 Sessions': { number: num(v?.ga4_sessions) },
    'Website Visitors': { number: num(v?.ga4_active_users) },
    'Supabase Signups': { number: v ? num(v.new_users) : null },
    'Newsletter Signups': { number: v ? num(v.new_subscribers) : null },
    'Total Leads': { number: num(totalLeads) },
    Notes: text(lines.join('\n')),
  };
}

export async function publishDaily(env, day, now = new Date()) {
  const readAt = now.toISOString();
  const [view] = await supa(env, `mpt_daily_metrics?day=eq.${day}&select=*`);
  const [raw] = await supa(env, `mpt_raw_metrics?source=eq.supabase&report=eq.table_counts&captured_at=gte.${hkDayStartOf(day).toISOString()}&captured_at=lt.${hkDayStartOf(addDays(day, 1)).toISOString()}&order=captured_at.desc&limit=1&select=payload`);
  // MPC-7556: the per-type email delivery counts for this HKT day (the collector's row whose period starts at this day). Null = not collected, never estimated.
  const [mail] = await supa(env, `mpt_raw_metrics?source=eq.supabase&report=eq.email_delivery_daily&status=eq.ok&period_start=eq.${encodeURIComponent(hkDayStartOf(day).toISOString())}&order=captured_at.desc&limit=1&select=payload`).catch(() => []);
  const properties = dailyProperties(day, view, raw?.payload?.counts?.leads, readAt, mail?.payload ?? null);
  const r = await upsert(env, cfg(env).daily, { key: day, keyProperty: 'Date', markerProperty: 'Notes', titleProperty: 'Name', title: day, properties });
  return { kind: 'daily', day, action: r.action, url: r.page.url };
}

// MPC-9972: weekly Google Ads efficiency from the stored google-ads/account_daily rows of the week (one latest row per HK day).
// cost per scan = cost / scan_started, CAC = cost / paid conversions. null when the denominator is 0 or no cost: never estimated, only shown when > 0.
export function adsEfficiency(rows) {
  const byDay = new Map();
  for (const r of rows ?? []) if (r?.payload?.configured && r.payload.summary) byDay.set(r.payload.day ?? r.period_start, r.payload.summary);
  let cost = 0, scans = 0, paid = 0;
  for (const s of byDay.values()) { cost += Number(s.cost) || 0; scans += Number(s.scan_started) || 0; paid += Number(s.paid_conversions) || 0; }
  const ratio = (n, d) => (n > 0 && d > 0 ? Math.round((100 * n) / d) / 100 : null);
  return { days: byDay.size, cost, scan_started: scans, paid_conversions: paid, cost_per_scan: ratio(cost, scans), cac: ratio(cost, paid) };
}

// CK-11491: the week's funnel. GA4 event counts come from the stored ga4/daily_events rows (latest row per HK day); report views come from the database,
// because GA4 cannot see the report page opened from the email. Event counts, not people. A part that was not collected is blank, never estimated.
export const FUNNEL_EVENTS = ['scan_start', 'scan_complete', 'report_view', 'pricing_view', 'checkout_start'];
export const FUNNEL_LIVE_FROM = '2026-11-27';
export function funnelCounts(ga4Rows) {
  const byDay = new Map();
  for (const r of ga4Rows ?? []) if (r?.payload) byDay.set(r.period_start, r.payload);   // rows arrive oldest capture first
  const counts = Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0]));
  for (const p of byDay.values()) for (const row of p.rows ?? []) {
    const name = row.dimensionValues?.[0]?.value;
    if (Object.hasOwn(counts, name)) counts[name] += Number(row.metricValues?.[0]?.value) || 0;
  }
  return { days: byDay.size, counts };
}
export function funnelLine(weekOf, f) {
  if (!f || addDays(weekOf, 6) < FUNNEL_LIVE_FROM) return null;   // before the events existed, a zero would read as "nobody"
  const rate = (n, d) => (d > 0 ? `${Math.round((1000 * n) / d) / 10}%` : 'blank (nothing to divide by)');
  const shown = (n) => (n === null || n === undefined ? 'blank' : n);
  const partial = weekOf < FUNNEL_LIVE_FROM ? ` PARTIAL: these events went live ${FUNNEL_LIVE_FROM}.` : '';
  const c = f.ga4?.days ? f.ga4.counts : null;
  const ga4 = c
    ? `GA4 (consented visitors only, ${f.ga4.days}/7 days): ${FUNNEL_EVENTS.map((e) => `${e} ${c[e]}`).join(', ')}. Scan completion rate ${rate(c.scan_complete, c.scan_start)}. checkout_start = paid plan chosen (waitlist, no live checkout).`
    : 'GA4: blank (no daily_events rows for the week).';
  const viewRate = f.reportEmails === null || f.reportViews === null ? 'blank' : rate(f.reportViews, f.reportEmails);
  return `Funnel (CK-11491).${partial} ${ga4} Database (real addresses only): report emails ${shown(f.reportEmails)}, report pages viewed ${shown(f.reportViews)}. Report view rate ${viewRate}.`;
}

export async function readFunnel(env, weekOf) {
  const from = encodeURIComponent(hkDayStartOf(weekOf).toISOString());
  const to = encodeURIComponent(hkDayStartOf(addDays(weekOf, 7)).toISOString());
  const read = (path) => supa(env, path).catch(() => null);
  const [ga4Rows, emails, views, column] = await Promise.all([
    read(`mpt_raw_metrics?source=eq.ga4&report=eq.daily_events&status=eq.ok&period_start=gte.${from}&period_start=lt.${to}&order=captured_at.asc&select=period_start,payload`),
    read(`email_sends?email_type=eq.report&is_test=is.false&sent_at=gte.${from}&sent_at=lt.${to}&select=id`),
    read(`learning_aggregate_daily?dimension=eq.funnel_step&key=eq.report_viewed&day=gte.${weekOf}&day=lt.${addDays(weekOf, 7)}&select=n`),
    read('scans?select=report_viewed_at&limit=1'),   // fails while migration 20261127070000 is not applied: no view can be recorded then, so the count is blank, not 0
  ]);
  return {
    ga4: ga4Rows ? funnelCounts(ga4Rows) : null,
    reportEmails: emails ? emails.length : null,
    reportViews: views && column ? views.reduce((n, r) => n + (Number(r.n) || 0), 0) : null,
  };
}

export function weeklyProperties(weekOf, v, readAt, previousId, ads = null, funnel = null) {
  const pct = num(v?.conversion_rate_pct);
  const src = (label, value, source) => (value === null ? `${label}: blank (${source} not collected or errored; not estimated)` : `${label}: ${value} (${source})`);
  const cumulative = num(v?.cumulative_scans);
  // The view has test_scans_excluded only once migration 20261127060000 is applied; until then the figure still includes test scans, and the row says so.
  const excluded = num(v?.test_scans_excluded);
  const scanSource = excluded === null
    ? 'public.scan_hourly_counts, decision D5; INCLUDES test scans'
    : `public.scan_hourly_counts without the test mailbox, ${excluded} test scans left out to date; scans with no evidence either way are counted, so an upper bound`;
  const active = num(v?.ga4_active_users);
  const mrr = num(v?.current_mrr);
  const blog = num(v?.blog_posts_published);
  const xt = num(v?.x_threads_posted);
  const insights = [
    `${MARKER} Week of ${weekOf}. Every number read ${readAt} from Supabase view mpt_weekly_metrics (project xmdmkumwxpgahmlweuug).`,
    src('Cumulative Scans', cumulative, scanSource),
    src('Conversion Rate %', pct, 'paid users / scans, current week only'),
    src('Current MRR', mrr, 'raw revenue/mrr pull'),
    src('GA4 Active Users', active, 'raw ga4 weekly_overview pull, property 515216281'),
    src('Blog Posts Published', blog, 'raw blog/posts_published pull'),
    src('X Threads Posted', xt, 'raw x/threads_posted pull'),
    ...(ads?.cost_per_scan ? [`Ad cost per scan: ${ads.cost_per_scan} (Google Ads cost ${ads.cost} / ${ads.scan_started} scan_started, ${ads.days} days)`] : []),
    ...(ads?.cac ? [`CAC: ${ads.cac} (Google Ads cost ${ads.cost} / ${ads.paid_conversions} paid conversions)`] : []),
    ...[funnelLine(weekOf, funnel)].filter(Boolean),
    `Other signals, not merged into Cumulative Scans: engagement sessions ${num(v?.engagement_sessions) ?? 'blank'}, full scans ${num(v?.engagement_full_scans) ?? 'blank'}, GA4 scan events ${num(v?.ga4_scan_events) ?? 'blank'}.`,
  ].join('\n');
  return {
    'Week Of': { date: { start: weekOf } },
    'Cumulative Scans': { number: cumulative },
    'Conversion Rate %': { number: pct === null ? null : pct / 100 }, // Notion percent format stores a fraction
    'Current MRR': { number: mrr },
    'GA4 Active Users': { number: active },
    'Blog Posts Published': { number: blog },
    'X Threads Posted': { number: xt },
    'Previous Week': { relation: previousId ? [{ id: previousId }] : [] },
    'Agent Insights': text(insights),
  };
}

export async function publishWeekly(env, weekOf, now = new Date()) {
  const readAt = now.toISOString();
  const ds = cfg(env).weekly;
  const [view] = await supa(env, `mpt_weekly_metrics?week_of=eq.${weekOf}&select=*`);
  if (!view) return { kind: 'weekly', weekOf, action: 'skipped_no_data' };
  const [prev] = await findPage(env, ds, 'Week Of', addDays(weekOf, -7));
  // Google Ads rows are optional: a read failure leaves the fields out, it never blocks the weekly row.
  const ads = await supa(env, `mpt_raw_metrics?source=eq.google-ads&report=eq.account_daily&status=eq.ok&period_start=gte.${encodeURIComponent(hkDayStartOf(weekOf).toISOString())}&period_start=lt.${encodeURIComponent(hkDayStartOf(addDays(weekOf, 7)).toISOString())}&order=captured_at.asc&select=period_start,payload`).then(adsEfficiency).catch(() => null);
  const funnel = addDays(weekOf, 6) >= FUNNEL_LIVE_FROM ? await readFunnel(env, weekOf) : null;
  const properties = weeklyProperties(weekOf, view, readAt, prev?.id, ads, funnel);
  const r = await upsert(env, ds, {
    key: weekOf, keyProperty: 'Week Of', markerProperty: 'Agent Insights', titleProperty: 'Entry', title: `Week of ${weekOf}`,
    properties, createOnly: { 'Linked Objective': { multi_select: [{ name: OBJECTIVE }] } },
  });
  if (r.action === 'skipped_not_ours') return { kind: 'weekly', weekOf, action: r.action, url: r.page.url };
  // Pace Status comes from Notion's own Pace Gap % formula, read back after the numbers are written.
  const fresh = await notion(env, 'GET', `/pages/${r.page.id}`);
  const status = paceStatus(fresh.properties?.['Pace Gap %']?.formula?.number);
  if (status) await notion(env, 'PATCH', `/pages/${r.page.id}`, { properties: { 'Pace Status': { select: { name: status } } } });
  return { kind: 'weekly', weekOf, action: r.action, url: r.page.url, paceStatus: status };
}

// Daily cron: publish yesterday's complete Hong Kong day; on Mondays (HKT) also the week that just ended.
// `parts` (MPC-9168) lets the scheduled run publish each part in its own Worker invocation (own subrequest budget); default is all three.
export const PUBLISH_PARTS = ['daily', 'weekly', 'learning-loop'];
export async function publishAll(env, now = new Date(), { day, weekOf, parts = PUBLISH_PARTS } = {}) {
  const today = hkDate(now); // Hong Kong calendar date; weekday logic below runs on this date string
  const out = [];
  const run = async (label, fn) => { try { out.push(await fn()); } catch (e) { out.push({ kind: label, action: 'error', error: String(e?.message ?? e).split(env.NOTION_TOKEN).join('[redacted]').slice(0, 300) }); } };
  const d = day || addDays(today, -1);
  if (parts.includes('daily')) await run('daily', () => publishDaily(env, d, now));
  const w = weekOf || (new Date(`${today}T00:00:00Z`).getUTCDay() === 1 ? addDays(today, -7) : null);
  if (w && parts.includes('weekly')) await run('weekly', () => publishWeekly(env, w, now));
  // MPC-7493: the learning-loop page for the same week, when a parent page is configured. Aggregates only.
  if (w && parts.includes('learning-loop') && learningLoopConfigured(env)) await run('learning-loop', () => publishLearningLoop(env, w, now));
  return out;
}
