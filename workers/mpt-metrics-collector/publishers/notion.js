// Notion publisher (MPC-7382): turns the Supabase rollup views into one daily row and one weekly row in Notion.
// Counts and summaries only, no personal data. Re-running a day or week updates the same row (never duplicates).
// A number the views report as NULL (source missing or status=error) is left blank, never estimated.
// Rows this publisher did not create (no MARKER in Notes / Agent Insights) are left untouched.
import { hkDate, hkDayStartOf } from '../lib/hk.js';

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

async function notion(env, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') || 1) * 1000)); continue; }
    if (!res.ok) throw new Error(`notion ${method} ${path.split('?')[0]} failed: HTTP ${res.status}`);
    return res.json();
  }
}

async function supa(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
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

export function dailyProperties(day, v, totalLeads, readAt) {
  const lines = [
    `${MARKER} ${day} (Hong Kong day, 00:00-24:00 HKT). Read ${readAt} from Supabase mpt_daily_metrics unless noted.`,
    `GA4 Sessions: ga4 daily_overview (activeUsers also -> Website Visitors). Supabase Signups: public.users created that day. Newsletter Signups: public.subscribers created that day.`,
    `Total Leads: supabase table_counts count of public.leads, latest pull that day. Blank = not collected or source error; nothing is estimated.`,
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
  const properties = dailyProperties(day, view, raw?.payload?.counts?.leads, readAt);
  const r = await upsert(env, cfg(env).daily, { key: day, keyProperty: 'Date', markerProperty: 'Notes', titleProperty: 'Name', title: day, properties });
  return { kind: 'daily', day, action: r.action, url: r.page.url };
}

export function weeklyProperties(weekOf, v, readAt, previousId) {
  const pct = num(v?.conversion_rate_pct);
  const src = (label, value, source) => (value === null ? `${label}: blank (${source} not collected or errored; not estimated)` : `${label}: ${value} (${source})`);
  const cumulative = num(v?.cumulative_scans);
  const active = num(v?.ga4_active_users);
  const mrr = num(v?.current_mrr);
  const blog = num(v?.blog_posts_published);
  const xt = num(v?.x_threads_posted);
  const insights = [
    `${MARKER} Week of ${weekOf}. Every number read ${readAt} from Supabase view mpt_weekly_metrics (project xmdmkumwxpgahmlweuug).`,
    src('Cumulative Scans', cumulative, 'rows in public.scans, decision D5'),
    src('Conversion Rate %', pct, 'paid users / scans, current week only'),
    src('Current MRR', mrr, 'raw revenue/mrr pull'),
    src('GA4 Active Users', active, 'raw ga4 weekly_overview pull, property 515216281'),
    src('Blog Posts Published', blog, 'raw blog/posts_published pull'),
    src('X Threads Posted', xt, 'raw x/threads_posted pull'),
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
  const properties = weeklyProperties(weekOf, view, readAt, prev?.id);
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
export async function publishAll(env, now = new Date(), { day, weekOf } = {}) {
  const today = hkDate(now); // Hong Kong calendar date; weekday logic below runs on this date string
  const out = [];
  const run = async (label, fn) => { try { out.push(await fn()); } catch (e) { out.push({ kind: label, action: 'error', error: String(e?.message ?? e).split(env.NOTION_TOKEN).join('[redacted]').slice(0, 300) }); } };
  const d = day || addDays(today, -1);
  await run('daily', () => publishDaily(env, d, now));
  const w = weekOf || (new Date(`${today}T00:00:00Z`).getUTCDay() === 1 ? addDays(today, -7) : null);
  if (w) await run('weekly', () => publishWeekly(env, w, now));
  return out;
}
