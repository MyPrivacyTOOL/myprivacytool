import worker, { COLLECTORS as ALL } from './worker.js';
import { publishAll, publishDaily, publishWeekly, paceStatus, mondayOf, addDays, MARKER } from './publishers/notion.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', COLLECTOR_TRIGGER_TOKEN: 'tok', NOTION_TOKEN: 'ntn_secret' };

// In-memory Notion + Supabase stubs.
let pages, calls, supa, paceGap, nextId;
const reset = () => { pages = []; calls = []; nextId = 1; paceGap = -99.2; supa = {
  daily: { day: '2026-10-09', ga4_sessions: 40, ga4_active_users: 31, new_users: 1, new_subscribers: 2 },
  weekly: { week_of: '2026-10-05', cumulative_scans: 1, weekly_new_scans: 1, conversion_rate_pct: 12.5, current_mrr: null, ga4_active_users: 77, blog_posts_published: 3, x_threads_posted: null, engagement_sessions: 4, engagement_full_scans: 1, ga4_scan_events: null },
  counts: { leads: 1 },
}; };
const rt = (v) => ({ rich_text: [{ plain_text: v }] });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const body = opts.body ? JSON.parse(opts.body) : null;
  const json = (b, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => b });
  if (url.includes('/rest/v1/mpt_daily_metrics')) return json(supa.daily ? [supa.daily] : []);
  if (url.includes('/rest/v1/mpt_weekly_metrics')) return json(supa.weekly ? [supa.weekly] : []);
  if (url.includes('/rest/v1/mpt_raw_metrics')) return json([{ payload: { counts: supa.counts } }]);
  calls.push({ url, method: opts.method, body, auth: opts.headers?.Authorization });
  const q = /data_sources\/([0-9a-f-]+)\/query/.exec(url);
  if (q) { const f = body.filter; const key = f.property;
    return json({ results: pages.filter((p) => p.ds === q[1] && p.props[key]?.date?.start === f.date.equals).map((p) => ({ id: p.id, url: p.url, properties: p.props })) }); }
  if (url.endsWith('/v1/pages') && opts.method === 'POST') {
    const id = `p${nextId++}`; const props = { ...body.properties };
    if (body.parent.data_source_id === '49361779-2050-4d96-8f69-ad1da1636810') props['Pace Gap %'] = { formula: { number: paceGap } };
    pages.push({ id, url: `https://notion.so/${id}`, ds: body.parent.data_source_id, props }); return json({ id, url: `https://notion.so/${id}` });
  }
  const pg = /\/v1\/pages\/(p\d+)$/.exec(url);
  if (pg) { const p = pages.find((x) => x.id === pg[1]);
    if (opts.method === 'PATCH') { Object.assign(p.props, body.properties); return json({ id: p.id, url: p.url }); }
    return json({ id: p.id, properties: p.props }); }
  return json({}, 404);
};
const WEEKLY = '49361779-2050-4d96-8f69-ad1da1636810', DAILY = '5bf43eae-1da1-438e-859d-56b241b5b1ac';
const now = new Date('2026-10-12T00:20:00Z'); // a Monday

check(paceStatus(0) === '🟢 On Track' && paceStatus(5) === '🟢 On Track', 'pace >= 0 => On Track');
check(paceStatus(-0.1) === '🟡 At Risk' && paceStatus(-15) === '🟡 At Risk', 'pace 0..-15 => At Risk');
check(paceStatus(-15.01) === '🔴 Behind' && paceStatus(null) === null, 'pace < -15 => Behind; unknown => no status');
check(mondayOf('2026-10-10') === '2026-10-05' && mondayOf('2026-10-05') === '2026-10-05' && addDays('2026-10-05', -7) === '2026-09-28', 'date helpers');

// Daily row
reset();
let r = await publishDaily(env, '2026-10-09', now);
let d = pages[0].props;
check(r.action === 'created' && pages.length === 1 && d['GA4 Sessions'].number === 40 && d['Website Visitors'].number === 31 && d['Total Leads'].number === 1, 'daily row created with mapped columns');
check(d.Date.date.start === '2026-10-09' && d.Notes.rich_text[0].text.content.startsWith(MARKER) && /Read 2026-10-12T00:20:00.000Z/.test(d.Notes.rich_text[0].text.content), 'daily row records source and read time');
check(d['Blog Reads'] === undefined && d['YouTube Views'] === undefined, 'columns with no source are not written');
supa.daily.ga4_sessions = null; r = await publishDaily(env, '2026-10-09', now);
check(r.action === 'updated' && pages.length === 1 && d['GA4 Sessions'].number === null, 're-run updates same row, error/missing source => blank');
pages[0].props.Notes = rt('typed by Chris'); r = await publishDaily(env, '2026-10-09', now);
check(r.action === 'skipped_not_ours' && pages[0].props.Notes.rich_text[0].plain_text === 'typed by Chris', 'rows not created by the publisher are left alone');

// Weekly row
reset();
r = await publishWeekly(env, '2026-10-05', now);
let w = pages[0].props;
check(r.action === 'created' && pages.length === 1 && w.Entry.title[0].text.content === 'Week of 2026-10-05' && w['Cumulative Scans'].number === 1, 'weekly row created');
check(pages[0].props['Week Of'].date.start === '2026-10-05' && w['Conversion Rate %'].number === 0.125 && w['GA4 Active Users'].number === 77 && w['Blog Posts Published'].number === 3, 'weekly numbers mapped (percent stored as fraction)');
check(w['Current MRR'].number === null && w['X Threads Posted'].number === null, 'missing sources left blank');
check(w['Agent Insights'].rich_text[0].text.content.includes('2026-10-12T00:20:00.000Z') && /rows in public\.scans/.test(w['Agent Insights'].rich_text[0].text.content) && /X Threads Posted: blank/.test(w['Agent Insights'].rich_text[0].text.content), 'Agent Insights has source and read time per number');
check(w['Pace Status'].select.name === '🔴 Behind' && r.paceStatus === '🔴 Behind', 'Pace Status set from Notion Pace Gap %');
const created = calls.find((c) => c.url.endsWith('/v1/pages') && c.method === 'POST');
check(created.body.properties.Entry.title[0].text.content === 'Week of 2026-10-05' && created.body.properties['Linked Objective'].multi_select[0].name === 'O3 — KPI pace', 'title and objective on create');
check(calls.every((c) => c.auth === 'Bearer ntn_secret') && !JSON.stringify(calls.map((c) => c.body)).includes('ntn_secret'), 'token only in Authorization header');
r = await publishWeekly(env, '2026-10-05', now);
check(r.action === 'updated' && pages.length === 1, 're-run updates the same week row');
const patch = calls.filter((c) => c.method === 'PATCH' && c.body.properties['Agent Insights'])[0];
check(patch.body.properties.Entry === undefined && patch.body.properties['Linked Objective'] === undefined, 'update does not touch Entry or Linked Objective');

// Next week links the previous one; pace thresholds drive the status
supa.weekly = { ...supa.weekly, week_of: '2026-10-12', cumulative_scans: 5 }; paceGap = -10;
r = await publishWeekly(env, '2026-10-12', now);
check(pages.length === 2 && pages[1].props['Previous Week'].relation[0].id === pages[0].id && pages[1].props['Pace Status'].select.name === '🟡 At Risk', 'Previous Week linked to prior row; At Risk at -10');
supa.weekly = { ...supa.weekly, week_of: '2026-10-19' }; paceGap = 3; await publishWeekly(env, '2026-10-19', now);
check(pages[2].props['Previous Week'].relation[0].id === pages[1].id && pages[2].props['Pace Status'].select.name === '🟢 On Track', 'On Track at +3');
reset(); pages.push({ id: 'p9', url: 'u', ds: WEEKLY, props: { 'Week Of': { date: { start: '2026-10-05' } }, 'Agent Insights': rt('') } }); nextId = 10;
r = await publishWeekly(env, '2026-10-05', now);
check(r.action === 'skipped_not_ours' && calls.every((c) => c.method !== 'PATCH'), 'existing hand-made week row is not edited');
reset(); supa.weekly = null; r = await publishWeekly(env, '2026-10-05', now);
check(r.action === 'skipped_no_data' && pages.length === 0, 'no view row => nothing written');

// Duplicate guard
reset(); r = await publishWeekly(env, '2026-10-05', now);
pages.push({ ...pages[0], id: 'p77' });
let threw = false; try { await publishWeekly(env, '2026-10-05', now); } catch (e) { threw = /refusing/.test(e.message); }
check(threw, 'duplicate rows already present => refuse rather than guess');

// publishAll: yesterday's daily, plus last week's row on Mondays
reset(); let out = await publishAll(env, now);
check(out.length === 2 && out[0].day === '2026-10-11' && out[1].weekOf === '2026-10-05', 'Monday => daily for yesterday + weekly for the week just ended');
reset(); out = await publishAll(env, new Date('2026-10-13T00:20:00Z'));
check(out.length === 1 && out[0].kind === 'daily', 'other days => daily only');
reset(); const realFetch = globalThis.fetch; globalThis.fetch = async (u, o) => (String(u).includes('api.notion.com') ? { ok: false, status: 500, headers: new Headers() } : realFetch(u, o));
out = await publishAll(env, now); globalThis.fetch = realFetch;
check(out.length === 2 && out.every((x) => x.action === 'error') && !JSON.stringify(out).includes('ntn_secret'), 'Notion failure is reported per row, not thrown');

// HTTP surface and scheduled hook
reset();
const call = (path, method = 'POST', headers = {}, e = env) => worker.fetch(new Request('https://w' + path, { method, headers }), e);
check((await call('/publish')).status === 401 && (await call('/publish', 'POST', { authorization: 'Bearer nope' })).status === 401, 'POST /publish needs the bearer token');
check((await call('/publish', 'POST', { authorization: 'Bearer tok' }, { ...env, NOTION_TOKEN: undefined })).status === 500, 'not configured => 500');
check((await call('/publish?day=bad', 'POST', { authorization: 'Bearer tok' })).status === 400, 'bad date => 400');
const res = await call('/publish?day=2026-10-09&week=2026-10-05', 'POST', { authorization: 'Bearer tok' });
check(res.status === 200 && (await res.json()).results.length === 2 && pages.length === 2, 'manual publish writes both rows');
reset(); const waits = []; const inserted = [];
const f2 = globalThis.fetch; globalThis.fetch = async (u, o = {}) => (String(u).endsWith('/rest/v1/mpt_raw_metrics') && o.method === 'POST' ? (inserted.push(1), { ok: true, status: 201 }) : String(u).includes('/rest/v1/') && o.method === 'HEAD' ? { ok: true, status: 200, headers: new Headers({ 'content-range': '0-0/1' }) } : f2(u, o));
await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
check(inserted.length === ALL.filter((c) => !c.skip?.(new Date())).length && pages.length >= 1, 'scheduled run collects every source, then publishes to Notion');
reset(); const w2 = []; pages = [];
await worker.scheduled({}, { ...env, NOTION_TOKEN: undefined }, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2);
check(pages.length === 0, 'without NOTION_TOKEN the publish step is skipped');
globalThis.fetch = f2;
process.exit(ok ? 0 : 1);
