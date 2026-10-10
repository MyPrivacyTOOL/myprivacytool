// Notion publisher (MPC-7382): writes one daily row and one weekly tracker row from the Supabase rollup views.
// Counts only: nothing person-level is read or written. Idempotent: a row is looked up by date / Week Of and
// updated in place, never duplicated. A source whose latest pull has status=error leaves its cells blank.
// Rows not written by this publisher (Agent Insights / Notes without MARKER) are never edited.
import { addDays, mondayOf, paceGapPct, paceStatus } from './pace.js';

export const MARKER = '[mpt-metrics-collector]';
const NOTION_VERSION = '2025-09-03';

// ---- Notion API (data-source flavour) ----
async function notion(env, method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`notion ${method} ${path.split('?')[0]} failed: HTTP ${res.status}`);
  return res.json();
}
const findByDate = async (env, ds, prop, date) =>
  (await notion(env, 'POST', `/data_sources/${ds}/query`, { filter: { property: prop, date: { equals: date } }, page_size: 5 })).results;

const text = (s) => ({ rich_text: s ? [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] : [] });
const title = (s) => ({ title: [{ type: 'text', text: { content: s } }] });
const num = (n) => ({ number: n == null || Number.isNaN(Number(n)) ? null : Number(n) });
const plain = (prop) => (prop?.rich_text ?? []).map((r) => r.plain_text ?? '').join('');

// Create or update. `owned` rows may have blanks written as null; rows we create simply omit them.
async function upsert(env, ds, dateProp, date, props, ownerProp) {
  const found = await findByDate(env, ds, dateProp, date);
  if (found.length === 0) {
    const created = await notion(env, 'POST', '/pages', { parent: { type: 'data_source_id', data_source_id: ds }, properties: stripNulls(props) });
    return { action: 'created', id: created.id, url: created.url };
  }
  const row = found[0];
  if (!plain(row.properties?.[ownerProp]).startsWith(MARKER)) return { action: 'skipped_not_ours', id: row.id, url: row.url };
  const updated = await notion(env, 'PATCH', `/pages/${row.id}`, { properties: props });
  return { action: 'updated', id: row.id, url: updated.url ?? row.url };
}
function stripNulls(props) {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => !('number' in v && v.number === null)));
}

// ---- Supabase reads (service role; views are counts only) ----
async function sbGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase GET ${path.split('?')[0]} failed: HTTP ${res.status}`);
  return res.json();
}

// Latest pull per source since `sinceIso`. A source whose latest pull is an error is "failed": its cells stay blank.
export async function sourceStatus(env, sinceIso) {
  const rows = await sbGet(env, `mpt_raw_metrics?select=source,report,status,captured_at&captured_at=gte.${encodeURIComponent(sinceIso)}&order=captured_at.desc`);
  const latest = {};
  for (const r of rows) if (!(r.source in latest)) latest[r.source] = r;
  return latest;
}
const failed = (status, source) => status[source]?.status === 'error';
const readAt = (status, source, fallback) => status[source]?.captured_at ?? fallback;

// ---- Daily row ----
export async function buildDaily(env, day, now) {
  const since = `${addDays(day, -1)}T00:00:00Z`;
  const [status, viewRows, counts] = await Promise.all([
    sourceStatus(env, since),
    sbGet(env, `mpt_daily_metrics?day=eq.${day}&select=ga4_sessions,ga4_active_users`),
    sbGet(env, `mpt_raw_metrics?source=eq.supabase&report=eq.table_counts&status=in.(ok,partial)&captured_at=gte.${encodeURIComponent(since)}&select=payload,captured_at&order=captured_at.desc&limit=1`),
  ]);
  const v = viewRows[0] ?? {};
  const c = counts[0]?.payload?.counts ?? {};
  const ga4Bad = failed(status, 'ga4'), sbBad = failed(status, 'supabase');
  const cells = {
    'GA4 Sessions': ga4Bad ? null : v.ga4_sessions ?? null,
    'Website Visitors': ga4Bad ? null : v.ga4_active_users ?? null,
    'Supabase Signups': sbBad ? null : c.users ?? null,
    'Total Leads': sbBad ? null : c.leads ?? null,
    'Newsletter Signups': sbBad ? null : c.subscribers ?? null,
  };
  const lines = [
    `GA4 Sessions, Website Visitors (GA4 activeUsers): view mpt_daily_metrics (raw ga4 daily_overview), read ${readAt(status, 'ga4', 'n/a')}${ga4Bad ? ' - latest pull FAILED, left blank' : ''}`,
    `Supabase Signups (total users), Total Leads (total leads), Newsletter Signups (total subscribers): raw supabase table_counts row, read ${counts[0]?.captured_at ?? 'n/a'}${sbBad ? ' - latest pull FAILED, left blank' : ''}`,
    'Not collected yet (left blank, never estimated): HubSpot Contacts, followers, YouTube, Blog Reads, Daily Growth Rate.',
  ];
  const props = {
    Name: title(day),
    Date: { date: { start: day } },
    ...Object.fromEntries(Object.entries(cells).map(([k, n]) => [k, num(n)])),
    Notes: text(`${MARKER} published ${now.toISOString()}\n${lines.join('\n')}`),
  };
  return { props, cells };
}

export async function publishDaily(env, day, now = new Date()) {
  const { props, cells } = await buildDaily(env, day, now);
  const r = await upsert(env, env.NOTION_DAILY_DATA_SOURCE_ID, 'Date', day, props, 'Notes');
  return { kind: 'daily', date: day, cells, ...r };
}

// ---- Weekly row ----
export async function buildWeekly(env, weekOf, now) {
  const since = `${weekOf}T00:00:00Z`;
  const [status, rows] = await Promise.all([
    sourceStatus(env, since),
    sbGet(env, `mpt_weekly_metrics?week_of=eq.${weekOf}&select=cumulative_scans,conversion_rate_pct,current_mrr,ga4_active_users,blog_posts_published,x_threads_posted`),
  ]);
  const w = rows[0] ?? {};
  const bad = { ga4: failed(status, 'ga4'), blog: failed(status, 'blog'), x: failed(status, 'x'), revenue: failed(status, 'revenue'), supabase: failed(status, 'supabase') };
  const cells = {
    'Cumulative Scans': w.cumulative_scans ?? null,
    // Notion percent columns store a fraction (0.05 = 5%); the view gives percent points.
    'Conversion Rate %': w.conversion_rate_pct == null ? null : Number(w.conversion_rate_pct) / 100,
    'Current MRR': bad.revenue ? null : w.current_mrr ?? null,
    'GA4 Active Users': bad.ga4 ? null : w.ga4_active_users ?? null,
    'Blog Posts Published': bad.blog ? null : w.blog_posts_published ?? null,
    'X Threads Posted': bad.x ? null : w.x_threads_posted ?? null,
  };
  const gap = paceGapPct(cells['Cumulative Scans'], weekOf);
  const pace = paceStatus(gap);
  const src = (name, s, note) => `${name}: ${note}, read ${readAt(status, s, now.toISOString())}${bad[s] ? ' - latest pull FAILED, left blank' : ''}`;
  const insights = [
    `${MARKER} published ${now.toISOString()} for week of ${weekOf}`,
    `Cumulative Scans, Conversion Rate %: Supabase view mpt_weekly_metrics (rows in public.scans; paid users / scans), read ${now.toISOString()}`,
    src('GA4 Active Users', 'ga4', 'view mpt_weekly_metrics (raw ga4 weekly_overview)'),
    src('Current MRR', 'revenue', 'view mpt_weekly_metrics (raw revenue mrr)'),
    src('Blog Posts Published', 'blog', 'view mpt_weekly_metrics (raw blog posts_published)'),
    src('X Threads Posted', 'x', 'view mpt_weekly_metrics (raw x threads_posted)'),
    gap == null ? 'Pace Status: not set (no scan count or no target yet)' : `Pace Status: gap ${gap.toFixed(1)}% vs ladder target (On Track >= 0, At Risk 0 to -15, Behind < -15)`,
    'Blank cells = not collected or latest pull failed; nothing is estimated.',
  ].join('\n');
  const props = {
    Entry: title(`Week of ${weekOf}`),
    'Week Of': { date: { start: weekOf } },
    ...Object.fromEntries(Object.entries(cells).map(([k, n]) => [k, num(n)])),
    'Pace Status': pace ? { select: { name: pace } } : { select: null },
    'Agent Insights': text(insights),
  };
  return { props, cells, gap, pace };
}

export async function publishWeekly(env, weekOf, now = new Date()) {
  const built = await buildWeekly(env, weekOf, now);
  const ds = env.NOTION_WEEKLY_DATA_SOURCE_ID;
  const prev = (await findByDate(env, ds, 'Week Of', addDays(weekOf, -7)))[0];
  const props = { ...built.props, 'Previous Week': { relation: prev ? [{ id: prev.id }] : [] } };
  const r = await upsert(env, ds, 'Week Of', weekOf, props, 'Agent Insights');
  return { kind: 'weekly', weekOf, gap: built.gap, pace: built.pace, previousWeekLinked: Boolean(prev), cells: built.cells, ...r };
}

// ---- Entry point used by the Worker ----
export const notionConfigured = (env) =>
  Boolean(env.NOTION_TOKEN && env.NOTION_DAILY_DATA_SOURCE_ID && env.NOTION_WEEKLY_DATA_SOURCE_ID && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

// Daily row every run; weekly row on Mondays (UTC) or when `forceWeekly` is set. Each publish is isolated.
export async function publishAll(env, now = new Date(), { forceWeekly = false } = {}) {
  const day = now.toISOString().slice(0, 10);
  const out = [];
  const attempt = async (kind, fn) => {
    try { out.push(await fn()); }
    catch (e) { out.push({ kind, status: 'error', error: String(e?.message ?? e).split(env.NOTION_TOKEN || '\u0000').join('[redacted]').slice(0, 300) }); }
  };
  await attempt('daily', () => publishDaily(env, day, now));
  if (forceWeekly || now.getUTCDay() === 1) await attempt('weekly', () => publishWeekly(env, mondayOf(day), now));
  return out;
}
