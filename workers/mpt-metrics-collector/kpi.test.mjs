// MPC-7618: KPI scorecard maths and the Notion dashboard publisher. Stubbed fetch, no network. Run: node workers/mpt-metrics-collector/kpi.test.mjs
import { GOALS, pct, growthPct, neededPerWeek, topSources, funnel, buildScorecard } from './lib/kpi.js';
import { publishKpiDashboard, buildBlocks, KPI_MARKER, DASHBOARD_PAGE_ID } from './publishers/kpi-dashboard.js';
import worker from './worker.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', NOTION_TOKEN: 'ntn_secret', COLLECTOR_TRIGGER_TOKEN: 'trig' };
const now = new Date('2026-10-12T06:00:00Z'); // Monday 14:00 HKT

// --- maths
check(pct(2500, 10000) === 25 && pct(1, 3) === 33.3 && pct(null, 10000) === null, 'pct: rounds to one decimal, blank stays blank');
check(growthPct(150, 100) === 50 && growthPct(50, 100) === -50 && growthPct(5, 0) === null && growthPct(null, 3) === null, 'growth: week on week, never from zero or a blank');
check(neededPerWeek(0, 1000, '2027-08-17') === 500 && neededPerWeek(null, 1000, '2027-08-17') === null && neededPerWeek(5, 1000, '2027-09-01') === null, 'needed per week: 1000 over 2 weeks left is 500 a week; blank and past-deadline give null');
const src = (rows) => ({ rows: rows.map(([s, m, n]) => ({ dimensionValues: [{ value: s }, { value: m }], metricValues: [{ value: String(n) }] })) });
const top = topSources([src([['google', 'organic', 10], ['(direct)', '(none)', 5], ['x', 'social', 1]]), src([['google', 'organic', 5], ['a', 'b', 2], ['c', 'd', 2], ['e', 'f', 2], ['g', 'h', 2]])], 5);
check(top.rows.length === 5 && top.rows[0].name === 'google / organic' && top.rows[0].sessions === 15 && top.total === 29 && top.rows[0].share_pct === 51.7, 'top sources: summed across days, top 5, share of all sessions');
const f = funnel({ sessions: 1000, scans: 200, saves: 20, paid: null });
check(f[1].from_previous_pct === 20 && f[1].drop_off === 800 && f[2].from_previous_pct === 10 && f[3].value === null && f[3].from_previous_pct === null, 'funnel: rates against the previous step, a missing step gives no rate');
check(funnel({ sessions: null, scans: 5, saves: 1, paid: 0 })[1].from_previous_pct === null, 'funnel: no rate after a missing step');
const card = buildScorecard({ today: '2026-10-12', totals: { scans: 500, paid: 3, saves: 40, mrr: null }, days: [], weeks: [{ week_of: '2026-10-12', weekly_new_scans: 9 }, { week_of: '2026-10-05', weekly_new_scans: 60 }, { week_of: '2026-09-28', weekly_new_scans: 40 }], sources: [], window: {} });
check(card.goals[2].value === null && card.goals[2].pct === null, 'ARR is blank, not 0, when no MRR was collected');
check(card.growth.wow_pct === 50 && card.growth.last_full_week_of === '2026-10-05' && card.growth.this_week_so_far === 9, 'growth uses the last two FULL weeks, not the partial one');
check(GOALS.scans === 10000 && GOALS.paid === 1000 && GOALS.arr === 120000, 'goals are the North Star numbers');

// --- publisher
let page, blocks, calls;
const reset = (existing = false) => { calls = []; page = existing ? [{ id: 'intro', type: 'callout', callout: { rich_text: [{ plain_text: 'Chris\'s one page' }] } }, { id: 'kpi1', type: 'callout', callout: { rich_text: [{ plain_text: `${KPI_MARKER} old` }] } }, { id: 'db1', type: 'child_database' }] : [{ id: 'intro', type: 'callout', callout: { rich_text: [{ plain_text: 'Chris\'s one page' }] } }, { id: 'db1', type: 'child_database' }]; blocks = { kpi1: [{ id: 'old1' }, { id: 'old2' }] }; };
const json = (b, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => b });
const daysRows = ['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05'].map((day, i) => ({ day, new_scans: 10 + i, ga4_sessions: i === 0 ? null : 100 + i, new_users: 1 }));
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const method = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push(`${method} ${url.replace(/^https:\/\/[^/]+/, '').split('?')[0]}`);
  if (url.includes('/rest/v1/scans')) return json([], 200, { 'content-range': '*/500' });
  if (url.includes('/rest/v1/users')) return json([], 200, { 'content-range': '*/3' });
  if (url.includes('web_scan_contacts')) return json([], 200, { 'content-range': '*/7' });
  if (url.includes('/rest/v1/mpt_daily_metrics')) return json(daysRows);
  if (url.includes('current_mrr=not.is.null')) return json([{ current_mrr: 100 }]);
  if (url.includes('/rest/v1/mpt_weekly_metrics')) return json([{ week_of: '2026-10-12', weekly_new_scans: 9 }, { week_of: '2026-10-05', weekly_new_scans: 60 }, { week_of: '2026-09-28', weekly_new_scans: 40 }]);
  if (url.includes('daily_source_medium')) return json([{ period_start: '2026-10-10T16:00:00Z', payload: src([['google', 'organic', 8]]) }, { period_start: '2026-10-10T16:00:00Z', payload: src([['google', 'organic', 99]]) }, { period_start: '2026-10-11T16:00:00Z', payload: src([['google', 'organic', 2], ['bing', 'organic', 1]]) }]);
  const kids = /\/v1\/blocks\/([^/?]+)\/children/.exec(url);
  if (kids && method === 'GET') return json({ results: kids[1] === DASHBOARD_PAGE_ID ? page : (blocks[kids[1]] ?? []) });
  if (kids && method === 'PATCH') { calls.push(`BODY ${JSON.stringify(body).slice(0, 0)}`); (blocks.sent ??= []).push({ target: kids[1], body }); return json({}); }
  if (/\/v1\/blocks\/[^/]+$/.test(url) && (method === 'DELETE' || method === 'PATCH')) return json({});
  return json({}, 404);
};

reset(); blocks.sent = [];
let r = await publishKpiDashboard(env, now);
const created = blocks.sent[0];
check(r.action === 'created' && created.target === DASHBOARD_PAGE_ID && created.body.after === 'intro', 'first run: scorecard created right after the intro callout');
const co = created.body.children[0].callout;
check(co.rich_text[0].text.content.startsWith(KPI_MARKER), 'created block carries the marker');
const flat = JSON.stringify(co.children);
check(flat.includes('500') && flat.includes('5%') && flat.includes('"3"') && flat.includes('1,200') /* ARR: mrr 100 x 12 */, 'live scans 500 (5%), paid 3, ARR 1,200 shown');
check(flat.includes('google / organic') && flat.includes('10') && !flat.includes('99'), 'sources: newest pull per day only (the older duplicate pull is not double counted)');
const trendDays = JSON.stringify(co.children[co.children.length - 2]);
check(trendDays.includes('2026-10-12') && trendDays.includes('2026-10-06') && !trendDays.includes('2026-10-05'), 'trend lists the latest 7 days, today first');
check(/not collected/.test(flat), 'a missing figure (paid conversions in the window) reads "not collected"');

reset(true); blocks.sent = [];
r = await publishKpiDashboard(env, now);
check(r.action === 'updated' && !calls.some((c) => c === 'DELETE /v1/blocks/intro' || c === 'DELETE /v1/blocks/db1' || c === 'DELETE /v1/blocks/kpi1'), 'second run: rewrites its own block only, never deletes the page\'s other blocks');
check(calls.filter((c) => c === 'DELETE /v1/blocks/old1' || c === 'DELETE /v1/blocks/old2').length === 2, 'old scorecard content is replaced');
check(blocks.sent.length === 1 && blocks.sent[0].target === 'kpi1', 'new content is appended into the same block (no duplicate scorecard)');

reset(true); page.push({ id: 'kpi2', type: 'callout', callout: { rich_text: [{ plain_text: `${KPI_MARKER} dup` }] } });
let threw = false; try { await publishKpiDashboard(env, now); } catch { threw = true; }
check(threw, 'two scorecard blocks => error, not a guess');

// --- worker wiring
const logs = []; const origErr = console.error; console.error = (m) => logs.push(m);
reset(); blocks.sent = [];
const pending = [];
await worker.scheduled({ cron: '*/30 * * * *' }, env, { waitUntil: (p) => pending.push(p) });
await Promise.all(pending);
console.error = origErr;
check(blocks.sent.length === 1 && !calls.some((c) => c.includes('mpt_raw_metrics') && c.startsWith('POST')), 'KPI cron refreshes Notion and writes no raw metrics rows');
const noAuth = await worker.fetch(new Request('https://w/publish-kpi', { method: 'POST' }), env);
check(noAuth.status === 401, 'POST /publish-kpi needs the bearer token');
check(buildBlocks(card, 'now').length === 11, 'scorecard has its 11 blocks');

process.exit(ok ? 0 : 1);
