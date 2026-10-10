import { publishAll, publishDaily, publishWeekly, MARKER } from './publishers/notion.js';
import { targetScans, paceGapPct, paceStatus, mondayOf } from './publishers/pace.js';
import worker from './worker.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const near = (a, b, e = 0.5) => Math.abs(a - b) < e;

// pace maths (decision record: ~2,109 target on 2026-10-05; thresholds On Track >=0, At Risk 0..-15, Behind < -15)
check(targetScans('2026-07-07') === 0 && targetScans('2026-09-30') === 2000 && targetScans('2027-08-01') === 10000, 'ladder anchor dates');
check(near(targetScans('2026-10-05'), 2108.7), 'target 2026-10-05 ~ 2,109');
check(paceStatus(0) === '🟢 On Track' && paceStatus(5) === '🟢 On Track', 'gap >= 0 => On Track');
check(paceStatus(-0.01) === '🟡 At Risk' && paceStatus(-15) === '🟡 At Risk', 'gap 0..-15 => At Risk (-15 inclusive)');
check(paceStatus(-15.01) === '🔴 Behind' && paceStatus(-99) === '🔴 Behind', 'gap < -15 => Behind');
check(paceStatus(null) === null && paceGapPct(null, '2026-10-05') === null && paceGapPct(5, '2026-07-07') === null, 'unknown scans / zero target => no status');
check(paceStatus(paceGapPct(1, '2026-10-05')) === '🔴 Behind', '1 scan on 2026-10-05 => Behind (matches D5)');
check(mondayOf('2026-10-10') === '2026-10-05' && mondayOf('2026-10-05') === '2026-10-05' && mondayOf('2026-10-11') === '2026-10-05', 'mondayOf');

// ---- fake Supabase + fake Notion ----
const env = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sbsecret', COLLECTOR_TRIGGER_TOKEN: 'tok',
  NOTION_TOKEN: 'ntsecret', NOTION_DAILY_DATA_SOURCE_ID: 'daily-ds', NOTION_WEEKLY_DATA_SOURCE_ID: 'weekly-ds',
};
let pages, seq, calls, rawStatus, dailyView, weeklyView, notionFail;
const reset = () => {
  pages = { 'daily-ds': [], 'weekly-ds': [] }; seq = 0; calls = []; notionFail = false;
  rawStatus = [{ source: 'supabase', report: 'table_counts', status: 'ok', captured_at: '2026-10-12T00:15:00Z' }];
  dailyView = [{ ga4_sessions: 40, ga4_active_users: 30 }];
  weeklyView = [{ cumulative_scans: 1, conversion_rate_pct: 0, current_mrr: null, ga4_active_users: 77, blog_posts_published: 3, x_threads_posted: null }];
};
const withPlain = (props) => { for (const v of Object.values(props)) if (v.rich_text) v.rich_text = v.rich_text.map((r) => ({ ...r, plain_text: r.text?.content ?? r.plain_text })); return props; };
const rowOf = (ds, id) => pages[ds].find((p) => p.id === id);
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const method = opts.method || 'GET';
  const jr = (b, status = 200) => ({ ok: status < 300, status, json: async () => b });
  if (url.startsWith('https://x.supabase.co/rest/v1/')) {
    const path = url.slice('https://x.supabase.co/rest/v1/'.length);
    if (path.startsWith('mpt_daily_metrics')) return jr(dailyView);
    if (path.startsWith('mpt_weekly_metrics')) return jr(weeklyView);
    if (path.startsWith('mpt_raw_metrics') && path.includes('report=eq.table_counts')) return jr([{ captured_at: '2026-10-12T00:15:00Z', payload: { counts: { users: 1, leads: 1, subscribers: 3, scans: 1 } } }]);
    if (path.startsWith('mpt_raw_metrics')) return jr(rawStatus);
  }
  if (url.startsWith('https://api.notion.com/v1')) {
    if (notionFail) return jr({}, 500);
    const path = url.slice('https://api.notion.com/v1'.length);
    calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    let m;
    if ((m = /^\/data_sources\/([^/]+)\/query$/.exec(path))) {
      const f = JSON.parse(opts.body).filter; const ds = m[1];
      const key = f.property;
      return jr({ results: pages[ds].filter((p) => p.properties[key]?.date?.start === f.date.equals) });
    }
    if (path === '/pages' && method === 'POST') {
      const b = JSON.parse(opts.body); const ds = b.parent.data_source_id;
      const p = { id: `p${++seq}`, url: `https://notion.so/p${seq}`, properties: withPlain(b.properties) }; pages[ds].push(p); return jr(p);
    }
    if ((m = /^\/pages\/(.+)$/.exec(path)) && method === 'PATCH') {
      const id = m[1]; for (const ds of Object.keys(pages)) { const p = rowOf(ds, id); if (p) { Object.assign(p.properties, withPlain(JSON.parse(opts.body).properties)); return jr(p); } }
    }
  }
  return jr({}, 404);
};
const plainOf = (p) => (p?.rich_text ?? []).map((r) => r.text?.content ?? r.plain_text ?? '').join('');
const D = new Date('2026-10-12T00:15:00Z'); // a Monday

// daily: create, idempotent update, blank on failed source
reset();
let r = await publishDaily(env, '2026-10-12', D);
let row = pages['daily-ds'][0];
check(r.action === 'created' && pages['daily-ds'].length === 1, 'daily row created');
check(row.properties.Name.title[0].text.content === '2026-10-12' && row.properties.Date.date.start === '2026-10-12', 'daily Name and Date');
check(row.properties['GA4 Sessions'].number === 40 && row.properties['Total Leads'].number === 1 && row.properties['Newsletter Signups'].number === 3 && row.properties['Supabase Signups'].number === 1, 'daily cells from sources, existing column names');
check(plainOf(row.properties.Notes).startsWith(MARKER) && /read 2026-10-12T00:15:00Z/.test(plainOf(row.properties.Notes)), 'daily Notes records source and read time');
check(!('HubSpot Contacts' in row.properties) && !('Daily Growth Rate' in row.properties), 'uncollected cells not written');
dailyView = [{ ga4_sessions: 55, ga4_active_users: 31 }];
r = await publishDaily(env, '2026-10-12', D);
check(r.action === 'updated' && pages['daily-ds'].length === 1 && pages['daily-ds'][0].properties['GA4 Sessions'].number === 55, 're-run updates same daily row, no duplicate');
rawStatus = [{ source: 'ga4', report: 'daily_overview', status: 'error', captured_at: '2026-10-12T00:16:00Z' }];
r = await publishDaily(env, '2026-10-12', D);
check(pages['daily-ds'][0].properties['GA4 Sessions'].number === null && pages['daily-ds'][0].properties['Website Visitors'].number === null, 'ga4 status=error => its cells blank');
check(pages['daily-ds'][0].properties['Total Leads'].number === 1, 'other sources unaffected');

// daily: row not written by us is never edited
reset(); pages['daily-ds'].push({ id: 'manual', url: 'u', properties: { Date: { date: { start: '2026-10-12' } }, Notes: { rich_text: [{ plain_text: 'hand entered' }] } } });
r = await publishDaily(env, '2026-10-12', D);
check(r.action === 'skipped_not_ours' && !calls.some((c) => c.method === 'PATCH'), 'foreign daily row left untouched');

// weekly: create, mapping, previous week link, pace status
reset();
pages['weekly-ds'].push({ id: 'prev', url: 'u', properties: { 'Week Of': { date: { start: '2026-10-05' } }, 'Agent Insights': { rich_text: [{ plain_text: 'Chris' }] } } });
r = await publishWeekly(env, '2026-10-12', D);
row = pages['weekly-ds'].find((p) => p.id !== 'prev');
check(r.action === 'created' && row.properties.Entry.title[0].text.content === 'Week of 2026-10-12' && row.properties['Week Of'].date.start === '2026-10-12', 'weekly Entry and Week Of');
check(row.properties['Cumulative Scans'].number === 1 && row.properties['GA4 Active Users'].number === 77 && row.properties['Blog Posts Published'].number === 3, 'weekly cells');
check(!('Current MRR' in row.properties) && !('X Threads Posted' in row.properties), 'null weekly cells left blank');
check(row.properties['Conversion Rate %'].number === 0, 'Conversion Rate % converted to a fraction');
check(row.properties['Previous Week'].relation[0].id === 'prev', 'Previous Week linked to prior Monday row');
check(row.properties['Pace Status'].select.name === '🔴 Behind' && r.pace === '🔴 Behind', 'Pace Status Behind at 1 scan');
check(/read /.test(plainOf(row.properties['Agent Insights'])) && /mpt_weekly_metrics/.test(plainOf(row.properties['Agent Insights'])) && plainOf(row.properties['Agent Insights']).startsWith(MARKER), 'Agent Insights records source and read time');
weeklyView = [{ ...weeklyView[0], conversion_rate_pct: 5 }];
r = await publishWeekly(env, '2026-10-12', D);
check(r.action === 'updated' && pages['weekly-ds'].length === 2, 're-run updates same weekly row, no duplicate');
check(pages['weekly-ds'][1].properties['Conversion Rate %'].number === 0.05, 'updated value written');
check(pages['weekly-ds'][0].properties['Agent Insights'].rich_text[0].plain_text === 'Chris', 'existing foreign row not edited');
rawStatus = [{ source: 'blog', report: 'posts_published', status: 'error', captured_at: '2026-10-12T00:16:00Z' }];
await publishWeekly(env, '2026-10-12', D);
check(pages['weekly-ds'][1].properties['Blog Posts Published'].number === null && pages['weekly-ds'][1].properties['GA4 Active Users'].number === 77, 'blog error blanks only blog cell');
// pace bands through the full path
for (const [scans, want] of [[100000, '🟢 On Track'], [1900, '🟡 At Risk'], [1000, '🔴 Behind']]) {
  reset(); weeklyView = [{ ...weeklyView[0], cumulative_scans: scans }];
  const x = await publishWeekly(env, '2026-10-05', D);
  check(x.pace === want, `scans ${scans} => ${want}`);
}
reset(); pages['weekly-ds'].push({ id: 'hand', url: 'u', properties: { 'Week Of': { date: { start: '2026-10-05' } }, 'Agent Insights': { rich_text: [{ plain_text: 'Claude chat entry' }] } } });
r = await publishWeekly(env, '2026-10-05', D);
check(r.action === 'skipped_not_ours', 'existing hand-entered week row is not edited');

// weekly only on Mondays; failures isolated
reset(); let out = await publishAll(env, new Date('2026-10-13T00:15:00Z'));
check(out.length === 1 && out[0].kind === 'daily', 'Tuesday: daily only');
reset(); out = await publishAll(env, D);
check(out.map((o) => o.kind).join() === 'daily,weekly', 'Monday: daily and weekly');
reset(); notionFail = true; out = await publishAll(env, D);
check(out.length === 2 && out.every((o) => o.status === 'error') && !JSON.stringify(out).includes('ntsecret'), 'Notion outage reported, no secret leaked, does not throw');

// Worker wiring: /run collects then publishes; unconfigured Notion is skipped, not fatal
reset();
const orig = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (opts.method === 'HEAD') return { ok: true, status: 200, headers: new Headers({ 'content-range': '0-0/5' }) };
  if (url.endsWith('/rest/v1/mpt_raw_metrics') && opts.method === 'POST') return { ok: true, status: 201 };
  return orig(url, opts);
};
const res = await worker.fetch(new Request('https://w/run?weekly=1', { method: 'POST', headers: { authorization: 'Bearer tok' } }), env);
const body = await res.json();
check(res.status === 200 && body.results.length === 1 && body.published.map((p) => p.kind).join() === 'daily,weekly', 'POST /run?weekly=1 collects then publishes both rows');
const res2 = await worker.fetch(new Request('https://w/run', { method: 'POST', headers: { authorization: 'Bearer tok' } }), { ...env, NOTION_TOKEN: undefined });
check((await res2.json()).published[0].status === 'skipped', 'no NOTION_TOKEN => publish skipped, collection still runs');
process.exit(ok ? 0 : 1);
